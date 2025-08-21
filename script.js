// === Firebase (CDN) === 
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.3/firebase-app.js";
import {
  getFirestore, collection, addDoc, doc, updateDoc, deleteDoc,
  onSnapshot, query, orderBy, Timestamp, getDocs, where
} from "https://www.gstatic.com/firebasejs/10.12.3/firebase-firestore.js";

// Config do teu projeto
const firebaseConfig = {
  apiKey: "AIzaSyC2gjkvXkoyvzndCYB3M0UarklUiXchX9w",
  authDomain: "gestao-calendario.firebaseapp.com",
  projectId: "gestao-calendario",
  storageBucket: "gestao-calendario.firebasestorage.app",
  messagingSenderId: "1055325913959",
  appId: "1:1055325913959:web:7e6280794536b9a22e65c2"
};
const app = initializeApp(firebaseConfig);
const db  = getFirestore(app);
const eventsCol = collection(db, "events");

// Cores por tipo
const TYPE_COLORS = {
  "Teletrabalho": "#3498db",
  "Formação":     "#f39c12",
  "Férias":       "#2ecc71",
  "Aniversário":  "#e91e63",
  "Ponte":        "#9c27b0",
  "Outros":       "#6c757d"
};

// === Helpers ===
const uuid = () => (crypto?.randomUUID ? crypto.randomUUID() : (Date.now()+"-"+Math.random().toString(16).slice(2)));
function pad2(n){ return String(n).padStart(2,"0"); }
function toYYYYMMDD(date){ return `${date.getFullYear()}-${pad2(date.getMonth()+1)}-${pad2(date.getDate())}`; }
function addDaysYYYYMMDD(dateStr, days){
  const [y,m,d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m-1, d); dt.setDate(dt.getDate()+days);
  return toYYYYMMDD(dt);
}
function normalizeToYMD(value){
  if (!value) return "";
  if (value && typeof value === "object" && typeof value.toDate === "function") {
    return toYYYYMMDD(value.toDate());
  }
  if (typeof value === "string") return value;
  try { return toYYYYMMDD(new Date(value)); } catch { return ""; }
}
function toISO(dateYMD, timeHM){ return `${dateYMD}T${timeHM || "00:00"}:00`; }
function diffDaysInclusive(startYMD, endYMD){
  const s = new Date(startYMD+"T00:00:00");
  const e = new Date(endYMD+"T00:00:00");
  return Math.round((e - s)/(24*3600*1000)) + 1;
}
// Está dentro da vista atual [start, end)?
function isEventInCurrentView(ev, viewStart, viewEnd){
  const start = ev.start ? ev.start : (ev.startStr ? new Date(ev.startStr) : null);
  const end   = ev.end   ? ev.end   : (ev.endStr   ? new Date(ev.endStr)   : null);
  const s = start ? start.getTime() : 0;
  const e = end   ? end.getTime()   : s + 1;
  return (s < viewEnd.getTime()) && (e > viewStart.getTime());
}

// === Série: apagar no Firestore ===
async function deleteWholeSeries(seriesId){
  const qSeries = query(eventsCol, where("seriesId","==",seriesId));
  const snap = await getDocs(qSeries);
  const tasks = [];
  snap.forEach(d => tasks.push(deleteDoc(doc(db,"events",d.id))));
  await Promise.all(tasks);
}
// Apagar série e remover do calendário (UX imediato)
async function deleteWholeSeriesClient(seriesId, calendar){
  await deleteWholeSeries(seriesId);
  calendar.getEvents().forEach(ev=>{
    if (ev.extendedProps.seriesId === seriesId) ev.remove();
  });
}
// Séries antigas sem seriesId: apaga TODOS com mesmo title/type/colaborador (sem intervalo)
async function deleteLegacySeriesAllTime({ title, type, colaborador }){
  const qLegacy = query(
    eventsCol,
    where("title","==",title),
    where("type","==",type),
    where("colaborador","==",colaborador)
  );
  const snap = await getDocs(qLegacy);
  const tasks = [];
  snap.forEach(d => tasks.push(deleteDoc(doc(db,"events",d.id))));
  await Promise.all(tasks);
}

// Firestore <-> FullCalendar
function docToEvent(docSnap){
  const data = docSnap.data();
  const allDay = data.allDay !== false;
  const desc = data.desc || "";
  const seriesId = data.seriesId || null;

  if (allDay){
    const s = normalizeToYMD(data.start);
    const e = normalizeToYMD(data.end);
    return {
      id: docSnap.id,
      title: data.title || `${data.type || "Evento"} - ${data.colaborador || ""}`.trim(),
      start: s,
      end: e ? addDaysYYYYMMDD(e,1) : "",
      allDay: true,
      extendedProps: { type: data.type || "", colaborador: data.colaborador || "", desc, seriesId }
    };
  } else {
    const start = data.start?.toDate ? data.start.toDate().toISOString() : data.start;
    const end   = data.end?.toDate   ? data.end.toDate().toISOString()   : data.end;
    return {
      id: docSnap.id,
      title: data.title || `${data.type || "Evento"} - ${data.colaborador || ""}`.trim(),
      start, end, allDay: false,
      extendedProps: { type: data.type || "", colaborador: data.colaborador || "", desc, seriesId }
    };
  }
}
async function createEventDoc({ title, type, colaborador, desc, allDay, startISOorYMD, endISOorYMD, seriesId }){
  const startTs = allDay ? Timestamp.fromDate(new Date(`${startISOorYMD}T00:00:00`)) : Timestamp.fromDate(new Date(startISOorYMD));
  const endTs   = allDay ? Timestamp.fromDate(new Date(`${endISOorYMD}T00:00:00`)) : Timestamp.fromDate(new Date(endISOorYMD));
  const payload = { title, type, colaborador, desc, allDay, start: startTs, end: endTs };
  if (seriesId) payload.seriesId = seriesId;
  return addDoc(eventsCol, payload);
}
async function updateEventDoc(id, payload){
  const ref = doc(db, "events", id);
  let { title, type, colaborador, desc, allDay, startISOorYMD, endISOorYMD, seriesId } = payload;
  const startTs = allDay ? Timestamp.fromDate(new Date(`${startISOorYMD}T00:00:00`)) : Timestamp.fromDate(new Date(startISOorYMD));
  const endTs   = allDay ? Timestamp.fromDate(new Date(`${endISOorYMD}T00:00:00`)) : Timestamp.fromDate(new Date(endISOorYMD));
  const upd = { title, type, colaborador, desc, allDay, start: startTs, end: endTs };
  if (seriesId !== undefined) upd.seriesId = seriesId || null;
  return updateDoc(ref, upd);
}
async function removeEvent(id){ return deleteDoc(doc(db, "events", id)); }

// Recorrência
function* iterateRecurrences({ startYMD, endYMD, startHM, endHM, allDay, freq, untilYMD }){
  const addMap = { weekly: d=>d.setDate(d.getDate()+7), monthly:d=>d.setMonth(d.getMonth()+1), yearly:d=>d.setFullYear(d.getFullYear()+1) };
  const addFn = addMap[freq];
  const durDays = allDay ? diffDaysInclusive(startYMD, endYMD) : null;
  let cur = new Date(startYMD+"T00:00:00");
  const until = untilYMD ? new Date(untilYMD+"T23:59:59") : null;

  while (true){
    const occStartYMD = toYYYYMMDD(cur);
    if (allDay){
      const occEndYMD = addDaysYYYYMMDD(occStartYMD, durDays - 1);
      yield { startYMD: occStartYMD, endYMD: occEndYMD, allDay: true };
    } else {
      yield { startISO: toISO(occStartYMD, startHM), endISO: toISO(occStartYMD, endHM), allDay: false };
    }
    if (!addFn) break;
    addFn(cur);
    if (until && cur > until) break;
  }
}

// Tooltip positioning
function clamp(v,min,max){ return Math.max(min, Math.min(max, v)); }
function placeTooltipNearEl(modalContentEl, anchorEl){
  const rect = anchorEl.getBoundingClientRect();
  const W = modalContentEl.offsetWidth  || 380;
  const H = modalContentEl.offsetHeight || 260;
  const margin = 10, vw = window.innerWidth, vh = window.innerHeight;

  let top = rect.bottom + margin, left = rect.left;
  if (top + H > vh) top = rect.top - H - margin;
  if (top < margin) top = clamp(vh/2 - H/2, margin, vh - H - margin);
  left = clamp(left, margin, vw - W - margin);

  modalContentEl.style.top = `${top}px`;
  modalContentEl.style.left = `${left}px`;
}
function placeTooltipAtPoint(modalContentEl, x, y){
  const W = modalContentEl.offsetWidth  || 380;
  const H = modalContentEl.offsetHeight || 260;
  const margin = 10, vw = window.innerWidth, vh = window.innerHeight;

  let top = y + margin, left = x + margin;
  if (top + H > vh) top = y - H - margin;
  if (left + W > vw) left = x - W - margin;
  if (top < margin) top = clamp(vh/2 - H/2, margin, vh - H - margin);
  if (left < margin) left = clamp(vw/2 - W/2, margin, vw - W - margin);

  modalContentEl.style.top = `${top}px`;
  modalContentEl.style.left = `${left}px`;
}

// ==== Mini-modal (3 botões) ====
function askDeleteChoiceModal(){
  return new Promise((resolve)=>{
    const dlg = document.getElementById("deleteDialog");
    if (!dlg) { resolve("cancel"); return; }

    const btnAll = document.getElementById("btnDelAll");
    const btnOne = document.getElementById("btnDelOne");
    const btnCancel = document.getElementById("btnDelCancel");
    const btnClose  = document.getElementById("deleteDialogClose");
    const box = dlg.querySelector(".modal-content");

    const close = (result) => {
      dlg.classList.add("hidden");
      dlg.setAttribute("aria-hidden","true");
      btnAll.removeEventListener("click", onAll);
      btnOne.removeEventListener("click", onOne);
      btnCancel.removeEventListener("click", onCancel);
      btnClose.removeEventListener("click", onCancel);
      document.removeEventListener("click", onBackdrop);
      resolve(result);
    };
    const onAll = ()=> close("all");
    const onOne = ()=> close("one");
    const onCancel = ()=> close("cancel");
    const onBackdrop = (e)=>{
      if (!dlg.classList.contains("hidden")){
        const inside = box.contains(e.target);
        const clickedOnEvent = e.target.closest && e.target.closest(".fc-event");
        if (!inside && !clickedOnEvent) close("cancel");
      }
    };

    btnAll.addEventListener("click", onAll);
    btnOne.addEventListener("click", onOne);
    btnCancel.addEventListener("click", onCancel);
    btnClose.addEventListener("click", onCancel);
    document.addEventListener("click", onBackdrop);

    dlg.classList.remove("hidden");
    dlg.setAttribute("aria-hidden","false");
  });
}
// Fallback (prompt) caso o modal não exista
function askDeleteChoicePrompt(){
  const resp = prompt("Apagar evento:\n1) Apagar TODAS as repetições\n2) Apagar apenas esta ocorrência\n3) Cancelar", "2");
  if (resp === null) return "cancel";
  const v = resp.trim();
  if (v === "1") return "all";
  if (v === "2") return "one";
  return "cancel";
}
// Escolhe modal se existir; senão, prompt
async function chooseDeleteChoice(){
  const dlg = document.getElementById("deleteDialog");
  if (dlg) return await askDeleteChoiceModal();
  return askDeleteChoicePrompt();
}

// Estado
let eventsCache = [];
let selectedEvent = null;
let lastMouse = { x: 200, y: 200 };
document.addEventListener("mousemove", (e)=>{ lastMouse = { x:e.clientX, y:e.clientY }; });

// ======= INIT ROBUSTO =======
function init(){
  const calendarEl   = document.getElementById("calendar");
  const filterTypeEl = document.getElementById("filterType");
  const filterColEl  = document.getElementById("filterColab");

  // Tooltips EDITAR
  const eventModal   = document.getElementById("eventModal");
  const eventBox     = eventModal.querySelector(".modal-content");
  const eClose       = eventModal.querySelector(".close");
  const eType = document.getElementById("modalType");
  const eCol  = document.getElementById("modalColaborador");
  const eDesc = document.getElementById("modalDesc");
  const eAllD = document.getElementById("modalAllDay");
  const eSD   = document.getElementById("modalStartDate");
  const eED   = document.getElementById("modalEndDate");
  const eST   = document.getElementById("modalStartTime");
  const eET   = document.getElementById("modalEndTime");
  const eSave = document.getElementById("modalSave");
  const eRep  = document.getElementById("modalRepeat");
  const eUntil= document.getElementById("modalRepeatUntil");
  const eApplySeries = document.getElementById("modalApplySeries");

  // Tooltips CRIAR
  const createModal  = document.getElementById("createModal");
  const createBox    = createModal.querySelector(".modal-content");
  const cClose       = createModal.querySelector(".close");
  const cType = document.getElementById("createType");
  const cCol  = document.getElementById("createColaborador");
  const cDesc = document.getElementById("createDesc");
  const cAllD = document.getElementById("createAllDay");
  const cSD   = document.getElementById("createStartDate");
  const cED   = document.getElementById("createEndDate");
  const cST   = document.getElementById("createStartTime");
  const cET   = document.getElementById("createEndTime");
  const cRep  = document.getElementById("createRepeat");
  const cUntil= document.getElementById("createRepeatUntil");
  const cSave = document.getElementById("createSave");

  const toggleCreateTimeFields = ()=>{ const all = cAllD.checked; cST.disabled = all; cET.disabled = all; if(all){cST.value=""; cET.value="";} };
  const toggleEditTimeFields   = ()=>{ const all = eAllD.checked; eST.disabled = all; eET.disabled = all; if(all){eST.value=""; eET.value="";} };
  cAllD.addEventListener("change", toggleCreateTimeFields);
  eAllD.addEventListener("change", toggleEditTimeFields);

  // FullCalendar
  const calendar = new FullCalendar.Calendar(calendarEl, {
    initialView: "dayGridMonth",
    selectable: true,
    selectMirror: true,
    editable: true,
    headerToolbar: { left:"prev,next today", center:"title", right:"dayGridMonth,timeGridWeek,listYear" },

    dateClick: (info) => {
      closeEdit(); // um tooltip por vez
      openCreateTooltip({ dateYMD: info.dateStr, endYMD: info.dateStr, allDay: true },
                        { anchorEl: info.dayEl, point: info.jsEvent ? {x:info.jsEvent.clientX, y:info.jsEvent.clientY}:null });
    },
    select: (info) => {
      closeEdit();
      if (info.allDay){
        openCreateTooltip({ dateYMD: info.startStr, endYMD: addDaysYYYYMMDD(info.endStr,-1), allDay: true },
                          { point: lastMouse });
      } else {
        const s = info.start, e = info.end || info.start;
        const sY = toYYYYMMDD(s);
        openCreateTooltip({ dateYMD: sY, endYMD: sY, allDay: false,
                            startHM: `${pad2(s.getHours())}:${pad2(s.getMinutes())}`,
                            endHM:   `${pad2(e.getHours())}:${pad2(e.getMinutes())}` },
                          { point: lastMouse });
      }
    },

    eventDidMount: (info) => {
      const color = TYPE_COLORS[info.event.extendedProps.type] || "#3a87ad";
      info.el.style.backgroundColor = color;
      info.el.style.borderColor     = color;
      info.el.style.color           = "#fff";
      if (info.event.extendedProps.desc) info.el.title = info.event.extendedProps.desc;
    },

    eventClick: (info) => {
      closeCreate(); // um tooltip por vez
      selectedEvent = info.event;

      eType.value = info.event.extendedProps.type || "";
      eCol.value  = info.event.extendedProps.colaborador || "";
      eDesc.value = info.event.extendedProps.desc || "";
      eRep.value  = "none";  // default (só altera se usar série)
      eUntil.value= "";

      if (info.event.allDay){
        eAllD.checked = true;
        eSD.value = info.event.startStr;
        eED.value = info.event.endStr ? addDaysYYYYMMDD(info.event.endStr,-1) : info.event.startStr;
        eST.value=""; eET.value=""; toggleEditTimeFields();
      } else {
        eAllD.checked = false;
        const s = info.event.start, e = info.event.end || info.event.start;
        eSD.value = toYYYYMMDD(s);
        eED.value = toYYYYMMDD(s);
        eST.value = `${pad2(s.getHours())}:${pad2(s.getMinutes())}`;
        eET.value = `${pad2(e.getHours())}:${pad2(e.getMinutes())}`;
        toggleEditTimeFields();
      }
      eventModal.classList.remove("hidden");
      requestAnimationFrame(()=> placeTooltipNearEl(eventBox, info.el));
    },

    eventDrop: async (info) => {
      const ev = info.event;
      try {
        if (ev.allDay){
          await updateEventDoc(ev.id, {
            title: ev.title, type: ev.extendedProps.type || "", colaborador: ev.extendedProps.colaborador || "", desc: ev.extendedProps.desc || "",
            allDay: true, startISOorYMD: ev.startStr, endISOorYMD: ev.endStr ? addDaysYYYYMMDD(ev.endStr,-1) : ev.startStr
          });
        } else {
          await updateEventDoc(ev.id, {
            title: ev.title, type: ev.extendedProps.type || "", colaborador: ev.extendedProps.colaborador || "", desc: ev.extendedProps.desc || "",
            allDay: false, startISOorYMD: ev.start.toISOString(), endISOorYMD: ev.end ? ev.end.toISOString() : ev.start.toISOString()
          });
        }
      } catch(e){ console.error(e); info.revert(); }
    },

    eventResize: async (info) => {
      const ev = info.event;
      try {
        if (ev.allDay){
          await updateEventDoc(ev.id, {
            title: ev.title, type: ev.extendedProps.type || "", colaborador: ev.extendedProps.colaborador || "", desc: ev.extendedProps.desc || "",
            allDay: true, startISOorYMD: ev.startStr, endISOorYMD: ev.endStr ? addDaysYYYYMMDD(ev.endStr,-1) : ev.startStr
          });
        } else {
          await updateEventDoc(ev.id, {
            title: ev.title, type: ev.extendedProps.type || "", colaborador: ev.extendedProps.colaborador || "", desc: ev.extendedProps.desc || "",
            allDay: false, startISOorYMD: ev.start.toISOString(), endISOorYMD: ev.end ? ev.end.toISOString() : ev.start.toISOString()
          });
        }
      } catch(e){ console.error(e); info.revert(); }
    }
  });
  calendar.render();

  // Firestore live
  const q = query(eventsCol, orderBy("start","asc"));
  onSnapshot(q, (snap)=>{
    eventsCache = snap.docs.map(docToEvent);
    applyFilters();
  });

  function applyFilters(){
    const t = filterTypeEl.value, c = filterColEl.value;
    const filtered = eventsCache.filter(ev => {
      const okT = !t || ev.extendedProps.type === t;
      const col = ev.extendedProps.colaborador || "";
      const okC = !c || col === c || col === "Todos";
      return okT && okC;
    });
    calendar.removeAllEvents();
    calendar.addEventSource(filtered);
  }
  filterTypeEl.addEventListener("change", applyFilters);
  filterColEl.addEventListener("change", applyFilters);

  // ====== CRIAR (tooltip) ======
  function openCreateTooltip({ dateYMD, endYMD, allDay, startHM, endHM }, pos){
    closeEdit(); // garante único tooltip

    cType.value=""; cCol.value=""; cDesc.value="";
    cAllD.checked = (allDay !== false);
    cSD.value = dateYMD;
    cED.value = endYMD || dateYMD;
    cST.value = startHM || "";
    cET.value = endHM   || "";
    cRep.value = "none";
    cUntil.value = "";
    toggleCreateTimeFields();

    createModal.classList.remove("hidden");
    createModal.setAttribute("aria-hidden","false");

    requestAnimationFrame(()=>{
      if (pos?.anchorEl) placeTooltipNearEl(createBox, pos.anchorEl);
      else if (pos?.point) placeTooltipAtPoint(createBox, pos.point.x, pos.point.y);
      else placeTooltipAtPoint(createBox, window.innerWidth/2, window.innerHeight/2);
    });
  }
  function closeCreate(){
    createModal.classList.add("hidden");
    createModal.setAttribute("aria-hidden","true");
  }
  cClose.addEventListener("click", closeCreate);
  document.addEventListener("click", (e)=>{
    if (createModal.classList.contains("hidden")) return;
    const inside = createBox.contains(e.target);
    const onCell = e.target.closest && (e.target.closest(".fc-daygrid-day") || e.target.closest(".fc-timegrid-slot"));
    if (!inside && !onCell) closeCreate();
  });

  cSave.addEventListener("click", async ()=>{
    const type = cType.value, col = cCol.value, desc = cDesc.value;
    const allD = cAllD.checked;
    const sY = cSD.value, eY = cED.value || sY;
    if (!type || !col || !sY){ alert("Preencha tipo, colaborador e data de início."); return; }

    const freq = cRep.value, until = cUntil.value;
    const hasRepeat = freq !== "none" && until;

    const sid = hasRepeat ? uuid() : null;
    const occurrences = iterateRecurrences({
      startYMD: sY, endYMD: eY,
      startHM: cST.value || "00:00",
      endHM:   cET.value || (cST.value || "00:00"),
      allDay: allD, freq, untilYMD: until
    });

    for (const occ of occurrences){
      const title = `${type} - ${col}`;
      if (occ.allDay){
        await createEventDoc({ title, type, colaborador: col, desc, allDay: true,
          startISOorYMD: occ.startYMD, endISOorYMD: occ.endYMD, seriesId: sid });
      } else {
        await createEventDoc({ title, type, colaborador: col, desc, allDay: false,
          startISOorYMD: occ.startISO, endISOorYMD: occ.endISO, seriesId: sid });
      }
    }
    closeCreate();
  });

  // ====== EDITAR (tooltip) ======
  function closeEdit(){
    eventModal.classList.add("hidden");
    eventModal.setAttribute("aria-hidden","true");
  }
  eClose.addEventListener("click", closeEdit);
  document.addEventListener("click", (e)=>{
    if (eventModal.classList.contains("hidden")) return;
    const inside = eventBox.contains(e.target);
    const onEvent = e.target.closest && e.target.closest(".fc-event");
    if (!inside && !onEvent) closeEdit();
  });

  // Guardar (editar ocorrência / série) — SÉRIE DE VERDADE
  eSave.addEventListener("click", async ()=>{
    if (!selectedEvent) return;

    const type = eType.value, col = eCol.value, desc = eDesc.value;
    const allD = eAllD.checked;
    const rep  = eRep.value;                 // none|weekly|monthly|yearly
    const until= eUntil.value;               // data ou vazio
    const applySeries = eApplySeries.checked;
    const curSid = selectedEvent.extendedProps.seriesId || null;

    let sY = eSD.value;
    let eY = eED.value || sY;
    let st = eST.value || "00:00";
    let et = eET.value || st;

    // Caso 1: editar só esta ocorrência
    if (!applySeries){
      if (allD){
        await updateEventDoc(selectedEvent.id, {
          title: `${type} - ${col}`, type, colaborador: col, desc,
          allDay: true, startISOorYMD: sY, endISOorYMD: eY, seriesId: curSid
        });
        selectedEvent.setAllDay(true);
        selectedEvent.setStart(sY);
        selectedEvent.setEnd(addDaysYYYYMMDD(eY,1));
      } else {
        const sISO = toISO(sY, st), eISO = toISO(sY, et);
        await updateEventDoc(selectedEvent.id, {
          title: `${type} - ${col}`, type, colaborador: col, desc,
          allDay: false, startISOorYMD: sISO, endISOorYMD: eISO, seriesId: curSid
        });
        selectedEvent.setAllDay(false);
        selectedEvent.setStart(sISO);
        selectedEvent.setEnd(eISO);
      }
      selectedEvent.setProp("title", `${type} - ${col}`);
      selectedEvent.setExtendedProp("type", type);
      selectedEvent.setExtendedProp("colaborador", col);
      selectedEvent.setExtendedProp("desc", desc);
      closeEdit();
      return;
    }

    // Aplicar à série inteira (precisa de repetição definida)
    if (rep === "none" || !until){
      alert("Para alterar a série, escolha um tipo de repetição e a data 'Até'.");
      return;
    }

    const sid = curSid || uuid();

    // 1) Apagar série antiga de verdade
    if (curSid){
      await deleteWholeSeriesClient(curSid, calendar); // apaga e remove do calendário
    } else {
      const oldTitle = selectedEvent.title;
      const oldType  = selectedEvent.extendedProps?.type || "";
      const oldCol   = selectedEvent.extendedProps?.colaborador || "";
      await deleteLegacySeriesAllTime({ title: oldTitle, type: oldType, colaborador: oldCol });
      calendar.getEvents().forEach(ev=>{
        const matches = (ev.title===oldTitle) && ((ev.extendedProps?.type||"")===oldType) && ((ev.extendedProps?.colaborador||"")===oldCol);
        if (matches) ev.remove();
      });
    }

    // 2) Recriar com a nova regra
    const occurrences = iterateRecurrences({
      startYMD: sY, endYMD: eY,
      startHM: st, endHM: et,
      allDay: allD, freq: rep, untilYMD: until
    });

    for (const occ of occurrences){
      const title = `${type} - ${col}`;
      if (occ.allDay){
        await createEventDoc({ title, type, colaborador: col, desc, allDay: true,
          startISOorYMD: occ.startYMD, endISOorYMD: occ.endYMD, seriesId: sid });
      } else {
        await createEventDoc({ title, type, colaborador: col, desc, allDay: false,
          startISOorYMD: occ.startISO, endISOorYMD: occ.endISO, seriesId: sid });
      }
    }
    closeEdit();
  });

  // ====== REMOVER — DELEGAÇÃO DE EVENTO (funciona SEMPRE) ======
  document.addEventListener("click", async (ev)=>{
    const btn = ev.target.closest && ev.target.closest("#modalDelete");
    if (!btn) return; // não é o botão Remover
    ev.preventDefault();

    if (!selectedEvent) return;

    const choice = await chooseDeleteChoice(); // 'all' | 'one' | 'cancel'
    if (choice === "cancel"){ closeEdit(); return; }

    const sid = selectedEvent.extendedProps?.seriesId || null;

    if (choice === "one"){
      await removeEvent(selectedEvent.id);
      selectedEvent.remove();
      selectedEvent = null;
      closeEdit();
      return;
    }

    // choice === "all"
    if (sid){
      await deleteWholeSeriesClient(sid, calendar); // apaga tudo no Firestore e remove do calendário
      selectedEvent = null;
      closeEdit();
      return;
    }

    // Sem seriesId (legado): apaga todos semelhantes (title/type/colaborador)
    const title = selectedEvent.title;
    const type  = selectedEvent.extendedProps?.type || "";
    const col   = selectedEvent.extendedProps?.colaborador || "";

    await deleteLegacySeriesAllTime({ title, type, colaborador: col });

    // Remove todos os visíveis no calendário também
    calendar.getEvents().forEach(ev2=>{
      const matches = (ev2.title===title)
        && ((ev2.extendedProps?.type||"")===type)
        && ((ev2.extendedProps?.colaborador||"")===col);
      if (matches) ev2.remove();
    });

    selectedEvent = null;
    closeEdit();
  });

  // ====== PDF (mini-relatório da VISTA atual) ======
  document.getElementById("exportBtn").addEventListener("click", () => {
    const viewStart = calendar.view.activeStart;
    const viewEnd   = calendar.view.activeEnd; // exclusivo
    const inView = calendar.getEvents().filter(ev => isEventInCurrentView(ev, viewStart, viewEnd));

    const rows = inView
      .map(ev => {
        const allDay = ev.allDay;
        const date   = allDay ? ev.startStr : toYYYYMMDD(ev.start);
        const time   = allDay ? "Dia inteiro" :
          `${pad2(ev.start.getHours())}:${pad2(ev.start.getMinutes())}` +
          (ev.end ? `–${pad2(ev.end.getHours())}:${pad2(ev.end.getMinutes())}` : "");
        const tipo   = ev.extendedProps.type || "";
        const col    = ev.extendedProps.colaborador || "";
        const desc   = (ev.extendedProps.desc || "").slice(0,120);
        return { date, time, tipo, col, desc };
      })
      .sort((a,b) => (a.date+a.time).localeCompare(b.date+b.time));

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });

    const title = "Relatório do Calendário (vista atual)";
    doc.setFontSize(14); doc.text(title, 40, 40);
    doc.setFontSize(10);
    const rangeStr = `${toYYYYMMDD(viewStart)} a ${toYYYYMMDD(new Date(viewEnd.getTime()-1))}`;
    const fTipo = document.getElementById("filterType").value || "Todos";
    const fCol  = document.getElementById("filterColab").value || "Todos";
    doc.text(`Período: ${rangeStr}`, 40, 58);
    doc.text(`Filtro Tipo: ${fTipo} | Filtro Colaborador: ${fCol}`, 40, 72);
    doc.text(`Total de eventos: ${rows.length}`, 40, 86);

    const head = [["Data","Hora","Tipo","Colaborador","Descrição"]];
    const body = rows.map(r => [r.date, r.time, r.tipo, r.col, r.desc]);

    doc.autoTable({
      startY: 100, head, body,
      styles: { fontSize: 9, cellPadding: 4 },
      headStyles: { fillColor: [123,108,255] }, /* lilás-azulado */
      columnStyles: { 0:{cellWidth:80}, 1:{cellWidth:70}, 2:{cellWidth:90}, 3:{cellWidth:90}, 4:{cellWidth:200} },
      didDrawPage: () => {
        const str = `Página ${doc.internal.getNumberOfPages()}`;
        doc.setFontSize(9);
        doc.text(str, doc.internal.pageSize.getWidth()-60, doc.internal.pageSize.getHeight()-20);
      }
    });

    doc.save(`Relatorio-${toYYYYMMDD(viewStart)}.pdf`);
  });
}

// Corre init de forma robusta (DOM já carregado ou não)
if (document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
