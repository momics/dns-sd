package com.momics.dnssd

import android.app.Activity
import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.os.Handler
import android.os.Looper
import android.util.Log
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Plugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Channel
import app.tauri.plugin.JSObject
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap

@InvokeArg
class BrowseStartArgs {
    var options: BrowseOptionsData? = null
    lateinit var channel: Channel
}

@InvokeArg
class BrowseOptionsData {
    var service: ServiceSpecData? = null
    var timeoutMs: Long? = null
}

@InvokeArg
class ServiceSpecData {
    var type: String? = null
    var protocol: String? = null
    var domain: String? = null
    // Accepted for API parity; NsdManager discovery does not filter by subtype.
    var subtypes: List<String>? = null
}

@InvokeArg
class BrowseStopArgs {
    var browseId: Long = 0
}

@InvokeArg
class AdvertiseStartArgs {
    var service: AdvertiseServiceSpec? = null
}

@InvokeArg
class AdvertiseServiceSpec {
    var name: String? = null
    var type: String? = null
    var protocol: String? = null
    var port: Long = 0
    var host: String? = null
    var domain: String? = null
    // Accepted for API parity; NsdManager registration does not support subtypes.
    var subtypes: List<String>? = null
    var txt: JSObject? = null
}

@InvokeArg
class AdvertiseStopArgs {
    var advertiseId: Long = 0
}

// Functional Android mDNS-SD plugin backed by NsdManager.
//
// Discovery, resolution and registration all use the OS NsdManager. Discovery
// events are streamed to JS over a Tauri Channel; the guest-js layer derives the
// unified `kind` (found/resolved/updated/removed) from the `isActive` flag and
// the presence of a resolved host/port.
//
// NsdManager limitations (documented in the package README):
//  - Non-`local` domains and custom hostnames are ignored (a warning is logged).
//  - TXT attributes are exposed as a `Map<String, byte[]>`; a key with no value
//    is reported as the bare-key form (`true`) — NsdManager cannot distinguish a
//    bare key from an explicit empty value.
@TauriPlugin
class DnsSdPlugin(private val activity: Activity): Plugin(activity) {
    private var nextBrowseId: Long = 1L
    private var nextAdvertiseId: Long = 1L

    private data class BrowseSession(
        val id: Long,
        val manager: NsdManager,
        val listener: NsdManager.DiscoveryListener,
        val channel: Channel,
        val services: ConcurrentHashMap<String, NsdServiceInfo> = ConcurrentHashMap(),
        val timeoutHandler: Handler? = null,
        val timeoutRunnable: Runnable? = null
    )
    private data class AdvertiseSession(
        val id: Long,
        val manager: NsdManager,
        val info: NsdServiceInfo,
        val listener: NsdManager.RegistrationListener
    )

    private val browseMap = ConcurrentHashMap<Long, BrowseSession>()
    private val advertiseMap = ConcurrentHashMap<Long, AdvertiseSession>()

    private fun allocBrowseId(): Long = nextBrowseId.also { nextBrowseId += 1 }
    private fun allocAdvertiseId(): Long = nextAdvertiseId.also { nextAdvertiseId += 1 }
    private fun nsd(): NsdManager? = activity.getSystemService(Context.NSD_SERVICE) as? NsdManager
    private fun nowMs(): Long = System.currentTimeMillis()

    private fun emitService(session: BrowseSession, info: NsdServiceInfo, isActive: Boolean) {
        val serviceData = JSObject()
        serviceData.put("name", info.serviceName)
        serviceData.put("fullName", info.serviceName + "." + info.serviceType + ".local.")
        serviceData.put("host", info.host?.hostName ?: info.host?.hostAddress)
        serviceData.put("port", info.port)
        serviceData.put("serviceType", info.serviceType + ".local.")
        serviceData.put("protocol", if (info.serviceType.contains("_udp")) "udp" else "tcp")
        serviceData.put("domain", "local")
        
        // Create proper JSON arrays
        val subtypesArray = org.json.JSONArray()
        serviceData.put("subtypes", subtypesArray)
        
        val addressesArray = org.json.JSONArray()
        info.host?.hostAddress?.let { addressesArray.put(it) }
        serviceData.put("addresses", addressesArray)
        
        val txt = JSObject()
        for ((key, value) in info.attributes) {
            if (value == null || value.isEmpty()) {
                // NsdManager cannot distinguish a bare key from an empty value;
                // report the bare-key form (`true`), per the shared contract.
                txt.put(key, true)
            } else {
                val bytes = JSONArray()
                for (byte in value) {
                    bytes.put(byte.toInt() and 0xFF)
                }
                txt.put(key, bytes)
            }
        }
        serviceData.put("txt", txt)
        serviceData.put("isActive", isActive)
        serviceData.put("lastSeenMs", nowMs())
        
        val payload = JSObject()
        payload.put("browseId", session.id)
        payload.put("service", serviceData)
        
        try {
            session.channel.send(payload)
        } catch (e: Exception) {
            Log.e("dns-sd", "Error sending service event: ${e.message}")
        }
    }
    
    private fun emitBrowseStopped(session: BrowseSession, reason: String) {
        val payload = JSObject()
        payload.put("browseId", session.id)
        payload.put("reason", reason)
        try {
            session.channel.send(payload)
        } catch (e: Exception) {
            Log.e("dns-sd", "Error sending browse stopped event: ${e.message}")
        }
    }

    private fun stopBrowseSession(session: BrowseSession, reason: String) {
        browseMap.remove(session.id)
        session.timeoutHandler?.let { handler ->
            session.timeoutRunnable?.let { handler.removeCallbacks(it) }
        }
        try {
            session.manager.stopServiceDiscovery(session.listener)
        } catch (_: Exception) {}
        emitBrowseStopped(session, reason)
    }

    @Command
    fun browse_start(invoke: Invoke) {
        val manager = nsd() ?: return invoke.reject("NsdManager unavailable")
        val args = invoke.parseArgs(BrowseStartArgs::class.java)
        val channel = args.channel
        val browseId = allocBrowseId()
        val typeRaw = args.options?.service?.type
        val protoRaw = args.options?.service?.protocol
        val serviceType = if (typeRaw != null && protoRaw != null) {
            val typeLabel = if (typeRaw.startsWith("_")) typeRaw else "_${typeRaw}"
            val protoLabel = if (protoRaw.lowercase() == "udp") "_udp" else "_tcp"
            "$typeLabel.$protoLabel"
        } else {
            // Default to http tcp if not specified
            "_http._tcp"
        }
        val timeoutMs = args.options?.timeoutMs ?: 30_000L
        val domain = args.options?.service?.domain
        if (!domain.isNullOrBlank() && domain.lowercase() != "local") {
            Log.w("dns-sd", "Android NSD ignores non-local domain '$domain'")
        }
        val listener = object : NsdManager.DiscoveryListener {
            override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) { 
                browseMap[browseId]?.let { stopBrowseSession(it, "error:$errorCode") }
            }
            override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) { 
                browseMap[browseId]?.let { stopBrowseSession(it, "error:$errorCode") }
            }
            override fun onDiscoveryStarted(serviceType: String) {}
            override fun onDiscoveryStopped(serviceType: String) { 
                browseMap[browseId]?.let { stopBrowseSession(it, "search-stopped") }
            }
            override fun onServiceFound(serviceInfo: NsdServiceInfo) {
                // Filter mismatch if user provided explicit type
                if (typeRaw != null && serviceInfo.serviceType != serviceType) return
                val key = serviceInfo.serviceName + serviceInfo.serviceType
                browseMap[browseId]?.services?.put(key, serviceInfo)
                manager.resolveService(serviceInfo, object : NsdManager.ResolveListener {
                    override fun onServiceResolved(resolved: NsdServiceInfo) {
                        // Update cache with resolved info
                        browseMap[browseId]?.services?.put(key, resolved)
                        browseMap[browseId]?.let { emitService(it, resolved, true) }
                    }
                    override fun onResolveFailed(serviceInfo: NsdServiceInfo, errorCode: Int) { 
                        browseMap[browseId]?.let { emitService(it, serviceInfo, false) }
                    }
                })
            }
            override fun onServiceLost(serviceInfo: NsdServiceInfo) {
                val key = serviceInfo.serviceName + serviceInfo.serviceType
                // Retrieve the original resolved service info from our cache
                val originalInfo = browseMap[browseId]?.services?.remove(key)
                // Use the original info if available, otherwise use what we have
                browseMap[browseId]?.let { emitService(it, originalInfo ?: serviceInfo, false) }
            }
        }
        val handler = if (timeoutMs > 0) Handler(Looper.getMainLooper()) else null
        val timeoutRunnable = if (timeoutMs > 0) Runnable {
            browseMap[browseId]?.let { stopBrowseSession(it, "timeout") }
        } else null
        val session = BrowseSession(browseId, manager, listener, channel, timeoutHandler = handler, timeoutRunnable = timeoutRunnable)
        browseMap[browseId] = session
        try {
            manager.discoverServices(serviceType, NsdManager.PROTOCOL_DNS_SD, listener)
        } catch (e: Exception) {
            browseMap.remove(browseId)
            return invoke.reject("Discovery failed: ${e.message}")
        }
        if (timeoutMs > 0) {
            handler?.postDelayed(timeoutRunnable!!, timeoutMs)
        }
        val ret = JSObject()
        ret.put("browseId", browseId)
        invoke.resolve(ret)
    }

    @Command
    fun browse_stop(invoke: Invoke) {
        val args = invoke.parseArgs(BrowseStopArgs::class.java)
        val session = browseMap.remove(args.browseId)
        if (session != null) {
            session.timeoutHandler?.let { handler ->
                session.timeoutRunnable?.let { handler.removeCallbacks(it) }
            }
            try { session.manager.stopServiceDiscovery(session.listener) } catch (_: Exception) {}
            emitBrowseStopped(session, "stopped")
        }
        invoke.resolve()
    }

    @Command
    fun advertise_start(invoke: Invoke) {
        val manager = nsd() ?: return invoke.reject("NsdManager unavailable")
        val args = invoke.parseArgs(AdvertiseStartArgs::class.java)
        val name = args.service?.name ?: return invoke.reject("Missing service.name")
        val typeRaw = args.service?.type ?: return invoke.reject("Missing service.type")
        val protoRaw = args.service?.protocol ?: "tcp"
        val port = args.service?.port?.toInt() ?: -1
        if (port <= 0) return invoke.reject("Invalid port")
        args.service?.domain?.let {
            if (it.lowercase() != "local") {
                Log.w("dns-sd", "Android NSD ignores non-local domain '$it' for advertise_start")
            }
        }
        args.service?.host?.let {
            Log.w("dns-sd", "Android NSD ignores custom host '$it' for advertise_start")
        }
        val typeLabel = if (typeRaw.startsWith("_")) typeRaw else "_${typeRaw}"
        val protoLabel = if (protoRaw.lowercase() == "udp") "_udp" else "_tcp"
        val serviceType = "$typeLabel.$protoLabel"
        val info = NsdServiceInfo().apply {
            serviceName = name
            this.serviceType = serviceType
            setPort(port)
        }
        args.service?.txt?.let { txt ->
            val keys = txt.keys()
            while (keys.hasNext()) {
                val key = keys.next()
                val value = txt.opt(key)
                when (value) {
                    null, JSONObject.NULL -> info.setAttribute(key, ByteArray(0))
                    is JSONArray -> {
                        val bytes = ByteArray(value.length()) { idx ->
                            (value.optInt(idx, 0) and 0xFF).toByte()
                        }
                        info.setAttribute(key, bytes)
                    }
                    is Boolean -> if (value) info.setAttribute(key, ByteArray(0))
                    else -> info.setAttribute(key, value.toString())
                }
            }
        }
        val advertiseId = allocAdvertiseId()
        val listener = object : NsdManager.RegistrationListener {
            override fun onServiceRegistered(serviceInfo: NsdServiceInfo) {}
            override fun onRegistrationFailed(serviceInfo: NsdServiceInfo, errorCode: Int) { /* Could emit error */ }
            override fun onServiceUnregistered(serviceInfo: NsdServiceInfo) {}
            override fun onUnregistrationFailed(serviceInfo: NsdServiceInfo, errorCode: Int) {}
        }
        advertiseMap[advertiseId] = AdvertiseSession(advertiseId, manager, info, listener)
        try { manager.registerService(info, NsdManager.PROTOCOL_DNS_SD, listener) } catch (e: Exception) {
            advertiseMap.remove(advertiseId)
            return invoke.reject("Registration failed: ${e.message}")
        }
        val ret = JSObject()
        ret.put("advertiseId", advertiseId)
        ret.put("name", name)
        invoke.resolve(ret)
    }

    @Command
    fun advertise_stop(invoke: Invoke) {
        val args = invoke.parseArgs(AdvertiseStopArgs::class.java)
        val session = advertiseMap.remove(args.advertiseId)
        if (session != null) {
            try { session.manager.unregisterService(session.listener) } catch (_: Exception) {}
        }
        invoke.resolve()
    }
}
