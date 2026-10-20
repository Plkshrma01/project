(() => {
  "use strict";
  const cfg = window.AUTOSETU_CONFIG || {};
  const $ = (id) => document.getElementById(id);
  const authView = $("auth-view"), dashboardView = $("dashboard-view");
  let supabase = null, currentUser = null, currentProfile = null;
  let passengerMap = null, driverMap = null, online = false, userMarker = null;
  const validConfig = cfg.supabaseUrl && cfg.supabaseAnonKey &&
    !cfg.supabaseUrl.includes("YOUR-PROJECT") && !cfg.supabaseAnonKey.includes("YOUR_SUPABASE");
  if (window.supabase && validConfig) {
    supabase = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
  }

  function toast(message, isError=false) {
    const el = $("toast"); el.textContent = message; el.classList.remove("hidden","error");
    if (isError) el.classList.add("error");
    window.clearTimeout(toast.timer); toast.timer = window.setTimeout(() => el.classList.add("hidden"), 5200);
  }
  function setAuthMessage(message, isError=false) {
    const el = $("auth-message"); el.textContent = message; el.classList.remove("hidden","error");
    if (isError) el.classList.add("error");
  }
  function clearAuthMessage(){ $("auth-message").classList.add("hidden"); }
  function showLogin() {
    $("login-form").classList.remove("hidden"); $("signup-form").classList.add("hidden");
    $("show-login").classList.add("active"); $("show-signup").classList.remove("active"); clearAuthMessage();
  }
  function showSignup() {
    $("signup-form").classList.remove("hidden"); $("login-form").classList.add("hidden");
    $("show-signup").classList.add("active"); $("show-login").classList.remove("active"); clearAuthMessage();
  }
  function friendlyError(err) {
    const msg = (err && err.message) ? err.message : String(err || "Unknown error");
    console.error("[AutoSetu]", {message: msg, code: err?.code, status: err?.status, details: err?.details, hint: err?.hint});
    if (/invalid login credentials/i.test(msg)) return "Email or password is incorrect. If you just signed up, check whether email confirmation is required.";
    if (/email not confirmed/i.test(msg)) return "Please confirm your email using the link sent by Supabase before logging in.";
    if (/already registered/i.test(msg)) return "This email already has an account. Try logging in instead.";
    if (/failed to fetch|network/i.test(msg)) return "Could not reach Supabase. Check your project URL, public key, and internet connection.";
    return msg;
  }
  function needClient() {
    if (supabase) return true;
    setAuthMessage("Supabase is not configured. Open js/config.js and replace the project URL and publishable/anon key with your own Supabase project values.", true);
    return false;
  }
  $("show-login").addEventListener("click", showLogin);
  $("show-signup").addEventListener("click", showSignup);

  $("signup-form").addEventListener("submit", async (e) => {
    e.preventDefault(); clearAuthMessage(); if (!needClient()) return;
    const name = $("signup-name").value.trim(), email = $("signup-email").value.trim();
    const password = $("signup-password").value, role = $("signup-role").value;
    if (name.length < 2 || password.length < 8) return setAuthMessage("Enter your name and a password of at least 8 characters.", true);
    const button = $("signup-form").querySelector('button[type="submit"]'); button.disabled = true; button.textContent = "Creating account…";
    try {
      const { data, error } = await supabase.auth.signUp({
        email, password,
        options: { data: { full_name: name, role }, emailRedirectTo: window.location.href.split("#")[0] }
      });
      if (error) throw error;
      if (data.session) {
        currentUser = data.user;
        await loadApp();
      } else {
        showLogin(); $("login-email").value = email;
        setAuthMessage("Account request received. Check your email for a confirmation link, then return here and log in. If email confirmation is disabled in your demo project, try logging in now.");
      }
    } catch (err) { setAuthMessage(friendlyError(err), true); }
    finally { button.disabled = false; button.innerHTML = 'Create account <span>→</span>'; }
  });

  $("login-form").addEventListener("submit", async (e) => {
    e.preventDefault(); clearAuthMessage(); if (!needClient()) return;
    const button = $("login-form").querySelector('button[type="submit"]'); button.disabled = true; button.textContent = "Logging in…";
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: $("login-email").value.trim(), password: $("login-password").value
      });
      if (error) throw error;
      currentUser = data.user; await loadApp();
    } catch (err) { setAuthMessage(friendlyError(err), true); }
    finally { button.disabled = false; button.innerHTML = 'Log in <span>→</span>'; }
  });

  $("forgot-password").addEventListener("click", async () => {
    if (!needClient()) return;
    const email = $("login-email").value.trim();
    if (!email) return setAuthMessage("Enter your email address first, then choose Forgot password.", true);
    try {
      const {error} = await supabase.auth.resetPasswordForEmail(email, {redirectTo: window.location.href.split("#")[0]});
      if (error) throw error;
      setAuthMessage("If an account exists for this email, Supabase will send a password-reset link.");
    } catch(err) { setAuthMessage(friendlyError(err), true); }
  });

  $("logout-button").addEventListener("click", async () => {
    if (supabase) { const {error} = await supabase.auth.signOut(); if(error) return toast(friendlyError(error), true); }
    currentUser = null; currentProfile = null; dashboardView.classList.add("hidden"); authView.classList.remove("hidden"); showLogin();
  });

  async function loadApp() {
    if (!supabase) return;
    const {data: {session}} = await supabase.auth.getSession();
    if (!session) { currentUser = null; dashboardView.classList.add("hidden"); authView.classList.remove("hidden"); return; }
    currentUser = session.user;
    let {data: profile, error} = await supabase.from("profiles").select("*").eq("id", currentUser.id).maybeSingle();
    if (error) throw error;
    if (!profile) {
      const role = currentUser.user_metadata?.role === "driver" ? "driver" : "passenger";
      const {data: made, error: insertError} = await supabase.from("profiles").insert({
        id: currentUser.id, role, full_name: currentUser.user_metadata?.full_name || currentUser.email?.split("@")[0] || "AutoSetu user"
      }).select().single();
      if (insertError) throw insertError;
      profile = made;
    }
    currentProfile = profile;
    authView.classList.add("hidden"); dashboardView.classList.remove("hidden");
    $("welcome-title").textContent = `Hello, ${(profile.full_name || "there").split(" ")[0]} 👋`;
    $("welcome-subtitle").textContent = profile.role === "driver" ? "Manage requests and share your planned journeys." : "Where would you like to go today?";
    $("role-eyebrow").textContent = profile.role === "driver" ? "DRIVER WORKSPACE" : "PASSENGER SPACE";
    $("current-user-email").textContent = currentUser.email || "";
    $("passenger-panel").classList.toggle("hidden", profile.role !== "passenger");
    $("driver-panel").classList.toggle("hidden", profile.role !== "driver");
    if (profile.role === "driver") {
      await ensureDriverProfile(); await loadDriverState(); await refreshDriverRides(); await refreshDriverCarpools(); initMap("driver-map");
    } else {
      await refreshPassengerRides(); await refreshCarpools(""); initMap("map");
    }
  }
  async function ensureDriverProfile() {
    const {data, error} = await supabase.from("drivers").select("user_id,is_online").eq("user_id", currentUser.id).maybeSingle();
    if (error) throw error;
    if (!data) {
      const {error: e} = await supabase.from("drivers").insert({user_id: currentUser.id, is_online:false});
      if (e) throw e;
    }
  }
  async function loadDriverState() {
    const {data,error} = await supabase.from("drivers").select("is_online").eq("user_id",currentUser.id).maybeSingle();
    if(error) throw error;
    online = !!data?.is_online; updateOnlineButton();
  }
  function updateOnlineButton() {
    const b = $("online-toggle"); b.textContent = online ? "● GO OFFLINE" : "GO ONLINE";
    b.classList.toggle("is-online", online); b.setAttribute("aria-pressed", String(online));
  }
  $("online-toggle").addEventListener("click", async () => {
    try {
      const next = !online;
      const {error} = await supabase.from("drivers").update({is_online:next, last_location_updated_at: new Date().toISOString()}).eq("user_id",currentUser.id);
      if(error) throw error; online = next; updateOnlineButton(); toast(online ? "You are online." : "You are offline.");
    } catch(err) { toast(friendlyError(err),true); }
  });

  $("ride-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const pickup = $("pickup-input").value.trim(), destination = $("destination-input").value.trim();
      if (!pickup || !destination) return toast("Enter both pickup and destination.",true);
      const fareValue = $("ride-fare").value;
      const {error} = await supabase.from("rides").insert({
        passenger_id: currentUser.id, pickup_text: pickup, destination_text: destination,
        ride_type: $("ride-type").value, agreed_fare: fareValue === "" ? null : Number(fareValue), status:"requested"
      });
      if(error) throw error;
      toast("Ride request created. A driver can now review it."); $("ride-form").reset(); await refreshPassengerRides();
    } catch(err) { toast(friendlyError(err),true); }
  });

  async function refreshPassengerRides() {
    const host = $("passenger-rides"); host.textContent = "Loading…";
    const {data,error} = await supabase.from("rides").select("id,pickup_text,destination_text,ride_type,status,created_at,agreed_fare,driver_id").eq("passenger_id",currentUser.id).order("created_at",{ascending:false}).limit(20);
    if(error) {host.textContent = friendlyError(error); return;}
    if(!data.length) {host.innerHTML = '<div class="empty-state">No rides yet. Request your first ride above.</div>';return;}
    host.innerHTML = data.map(r => `<article class="ride-card"><div><strong>${esc(r.pickup_text)} → ${esc(r.destination_text)}</strong><p>${esc(r.ride_type)} · ${new Date(r.created_at).toLocaleString()}${r.agreed_fare != null ? " · ₹"+Number(r.agreed_fare).toFixed(0):""}</p><span class="status">${esc(r.status.replaceAll("_"," "))}</span></div><div class="mini-actions">${["requested","accepted"].includes(r.status)?`<button data-cancel-ride="${r.id}">Cancel</button>`:""}</div></article>`).join("");
    host.querySelectorAll("[data-cancel-ride]").forEach(b => b.addEventListener("click",()=>changeRideStatus(b.dataset.cancelRide,"cancelled")));
  }
  async function refreshDriverRides() {
    const host = $("driver-rides"); host.textContent = "Loading…";
    const {data,error} = await supabase.from("rides").select("id,passenger_id,driver_id,pickup_text,destination_text,ride_type,status,created_at,agreed_fare").in("status",["requested","accepted","driver_on_the_way","arrived","started"]).order("created_at",{ascending:true}).limit(30);
    if(error) {host.textContent = friendlyError(error);return;}
    const relevant = (data||[]).filter(r => r.status==="requested" || r.driver_id===currentUser.id);
    if(!relevant.length) {host.innerHTML='<div class="empty-state">No ride requests right now. Stay online to be available.</div>';return;}
    host.innerHTML = relevant.map(r => `<article class="ride-card"><div><strong>${esc(r.pickup_text)} → ${esc(r.destination_text)}</strong><p>${esc(r.ride_type)} · ${new Date(r.created_at).toLocaleString()}</p><span class="status">${esc(r.status.replaceAll("_"," "))}</span></div><div class="mini-actions">${r.status==="requested"?`<button data-ride="${r.id}" data-status="accepted">Accept</button><button data-ride="${r.id}" data-status="cancelled">Reject</button>`:nextStatuses(r.status).map(s=>`<button data-ride="${r.id}" data-status="${s}">${labelStatus(s)}</button>`).join("")}</div></article>`).join("");
    host.querySelectorAll("[data-ride]").forEach(b=>b.addEventListener("click",()=>changeRideStatus(b.dataset.ride,b.dataset.status)));
  }
  function nextStatuses(s) { return ({accepted:["driver_on_the_way","cancelled"],driver_on_the_way:["arrived","cancelled"],arrived:["started"],started:["completed"]})[s]||[]; }
  function labelStatus(s) { return ({driver_on_the_way:"On the way",arrived:"Arrived",started:"Start ride",completed:"Complete",cancelled:"Cancel"})[s]||s; }
  async function changeRideStatus(id,status) {
    try {
      const updates = {status};
      if(status==="accepted") updates.driver_id = currentUser.id;
      if(status==="completed") updates.completed_at = new Date().toISOString();
      const {error} = await supabase.from("rides").update(updates).eq("id",id);
      if(error) throw error; toast("Ride status updated."); await refreshDriverRides(); await refreshPassengerRides();
    } catch(err) {toast(friendlyError(err),true);}
  }
  $("refresh-rides").addEventListener("click",refreshPassengerRides);
  $("refresh-driver-rides").addEventListener("click",refreshDriverRides);

  $("carpool-form").addEventListener("submit",async(e)=>{
    e.preventDefault();
    try {
      const date = $("carpool-date").value, time = $("carpool-time").value;
      if(date < new Date().toISOString().slice(0,10)) return toast("Choose today or a future date.",true);
      const {error} = await supabase.from("carpools").insert({
        driver_id:currentUser.id, origin_text:$("carpool-from").value.trim(), destination_text:$("carpool-to").value.trim(),
        departure_at:new Date(`${date}T${time}`).toISOString(), available_seats:Number($("carpool-seats").value),
        vehicle_info:$("carpool-vehicle").value.trim()||null, cost_contribution:$("carpool-cost").value===""?null:Number($("carpool-cost").value), status:"published"
      });
      if(error) throw error; toast("Carpool published."); $("carpool-form").reset(); await refreshDriverCarpools();
    } catch(err){toast(friendlyError(err),true);}
  });
  async function refreshDriverCarpools() {
    const host=$("driver-carpools"); const {data,error}=await supabase.from("carpools").select("*").eq("driver_id",currentUser.id).order("departure_at",{ascending:true}).limit(30);
    if(error){host.textContent=friendlyError(error);return;} renderCarpools(host,data||[],false);
  }
  async function refreshCarpools(filters) {
    const host=$("carpool-results");
    let q=supabase.from("carpools").select("id,driver_id,origin_text,destination_text,departure_at,available_seats,vehicle_info,cost_contribution,status").eq("status","published").gt("available_seats",0).gte("departure_at",new Date().toISOString()).order("departure_at",{ascending:true}).limit(30);
    if(filters?.from) q=q.ilike("origin_text",`%${filters.from}%`);
    if(filters?.to) q=q.ilike("destination_text",`%${filters.to}%`);
    const {data,error}=await q;
    if(error){host.textContent=friendlyError(error);return;} renderCarpools(host,data||[],true);
  }
  function renderCarpools(host,data,showRequest) {
    if(!data.length){host.innerHTML='<div class="empty-state">No matching published carpools found yet.</div>';return;}
    host.innerHTML=data.map(c=>`<article class="carpool-card"><div><strong>${esc(c.origin_text)} → ${esc(c.destination_text)}</strong><p>${new Date(c.departure_at).toLocaleString()} · ${Number(c.available_seats)} seat(s) · ${esc(c.vehicle_info||"Vehicle details not provided")}${c.cost_contribution!=null?" · suggested contribution ₹"+Number(c.cost_contribution):""}</p></div>${showRequest?`<div class="mini-actions"><button data-carpool="${c.id}">Request seat</button></div>`:""}</article>`).join("");
    host.querySelectorAll("[data-carpool]").forEach(b=>b.addEventListener("click",()=>requestSeat(b.dataset.carpool)));
  }
  async function requestSeat(id) {
    try {
      const {error}=await supabase.from("carpool_requests").insert({carpool_id:id,passenger_id:currentUser.id,status:"requested"});
      if(error) throw error; toast("Seat request sent to the driver.");
    } catch(err){toast(friendlyError(err),true);}
  }
  $("carpool-search").addEventListener("submit",async(e)=>{e.preventDefault();await refreshCarpools({from:$("carpool-search-from").value.trim(),to:$("carpool-search-to").value.trim()});});
  $("refresh-carpools").addEventListener("click",refreshDriverCarpools);

  function initMap(id) {
    if(!window.L) return;
    const isDriver=id==="driver-map"; let map=isDriver?driverMap:passengerMap;
    if(map) {setTimeout(()=>map.invalidateSize(),100);return;}
    map=L.map(id).setView([30.9010,75.8573],12);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:'&copy; OpenStreetMap contributors'}).addTo(map);
    L.marker([30.9010,75.8573]).addTo(map).bindPopup("AutoSetu map view · move the map to your area");
    if(isDriver) driverMap=map; else passengerMap=map;
    setTimeout(()=>map.invalidateSize(),250);
  }
  function locate(isDriver) {
    const map=isDriver?driverMap:passengerMap, status=$(isDriver?"driver-location-status":"location-status");
    if(!navigator.geolocation){status.textContent="Geolocation is not supported by this browser.";return;}
    status.textContent="Requesting location permission…";
    navigator.geolocation.getCurrentPosition(async pos=>{
      const lat=pos.coords.latitude,lng=pos.coords.longitude;
      if(map){map.setView([lat,lng],15);if(userMarker) userMarker.remove();userMarker=L.marker([lat,lng]).addTo(map).bindPopup("Your current location").openPopup();}
      status.textContent="Map centered on your current location. Location is not continuously tracked.";
      if(isDriver && supabase && currentUser) {
        try {const {error}=await supabase.from("drivers").update({last_latitude:lat,last_longitude:lng,last_location_updated_at:new Date().toISOString()}).eq("user_id",currentUser.id);if(error) throw error;}
        catch(err){toast(friendlyError(err),true);}
      }
    },err=>{status.textContent=err.code===1?"Location permission was denied. You can still use the map.":"Could not read your location. Check browser location permissions.";},{enableHighAccuracy:true,timeout:12000,maximumAge:30000});
  }
  $("locate-button").addEventListener("click",()=>locate(false));
  $("driver-locate-button").addEventListener("click",()=>locate(true));
  function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}

  if(supabase) {
    supabase.auth.onAuthStateChange((event,session)=>{
      if(event==="SIGNED_OUT"){currentUser=null;currentProfile=null;dashboardView.classList.add("hidden");authView.classList.remove("hidden");}
      if(event==="SIGNED_IN" && session && !currentUser) { currentUser=session.user; setTimeout(()=>loadApp().catch(err=>toast(friendlyError(err),true)),0); }
    });
    supabase.auth.getSession().then(({data})=>{
      if(data.session) loadApp().catch(err=>{console.error(err);toast("Signed in, but dashboard setup failed: "+friendlyError(err),true);});
    }).catch(err=>console.error(err));
  }
})();
