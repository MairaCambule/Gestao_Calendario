// script.js — FullCalendar + Firebase Firestore (Timestamp) + cores por tipo + selects de colaboradores

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.3/firebase-app.js";
import { 
  getFirestore, collection, addDoc, doc, updateDoc, deleteDoc, onSnapshot, query, orderBy, Timestamp 
} from "https://www.gstatic.com/firebasejs/10.12.3/firebase-firestore.js";

// 🔑 COLE aqui o SEU firebaseConfig (Console Firebase → Project settings → Your apps → Web → Config/CDN)
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

// === CORES POR TIPO ===
const TYPE_COLORS = {
  "Teletrabalho": "#3498db",
  "Formação":     "#f39c12",
  "Férias":       "#2ecc71",
  "Outros":       "#9b59b6"
};

// ===== Helpers de data =====
function toYYYYMMDD(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth()+1).padStart(2,"0");
  const d = String(date.getDate()).padStart(2,"0");
  return `${y}-${m}-${d}`;
}
function addDaysYYYYMMDD(dateStr, days) {
  const [y,m,d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m-1, d);
  dt.setDate(dt.getDate()+days);
  return toYYYYMMDD(dt);
}
function normalizeToYMD(value) {
  if (!value) return "";
  if (value && typeof value === "object" && typeof value.toDate === "function") {
    return toYYYYMMDD(value.toDate());
  }
  if (typeof value === "string") return value;
  try { return toYYYYMMDD(new Date(value)); } catch(e) { return ""; }
}

// Firestore doc -> FullCalendar event
function docToEvent(docSnap) {
  const data = docSnap.data();
  const startYMD = normalizeToYMD(data.start);
  const endInclusiveYMD = normalizeToYMD(data.end);
  const endExclusiveYMD = endInclusiveYMD ? addDaysYYYYMMDD(endInclusiveYMD, 1) : "";
  return {
    id: docSnap.id,
    title: data.title || data.type || "Evento",
    start: startYMD,
    end: endExclusiveYMD,
    extendedProps: {
      type: data.type || "",
      colaborador: data.colaborador || ""
    }
  };
}

// CRUD Firestore (guardamos Timestamp à meia-noite)
async function createEvent(payload) {
  const startTs = Timestamp.fromDate(new Date(payload.startYMD + "T00:00:00"));
  const endTs   = Timestamp.fromDate(new Date(payload.endYMD   + "T00:00:00"));
  return addDoc(eventsCol, {
    title: payload.title,
    start: startTs,
    end:   endTs,   // inclusivo
    type:  payload.type,
    colaborador: payload.colaborador
  });
}
async function updateEvent(id, payload) {
  const ref = doc(db, "events", id);
  const startTs = Timestamp.fromDate(new Date(payload.startYMD + "T00:00:00"));
  const endTs   = Timestamp.fromDate(new Date(payload.endYMD   + "T00:00:00"));
  return updateDoc(ref, {
    title: payload.title,
    start: startTs,
    end:   endTs,
    type:  payload.type,
    colaborador: payload.colaborador
  });
}
async function removeEvent(id) {
  return deleteDoc(doc(db, "events", id));
}

// ===== UI + FullCalendar =====
let eventsCache = [];
let selectedEvent = null;

document.addEventListener("DOMContentLoaded", async function() {
  const calendarEl = document.getElementById("calendar");
  const calendar = new FullCalendar.Calendar(calendarEl, {
    initialView: "dayGridMonth",
    selectable: true,
    editable: true,
    events: [],
    // pinta os eventos por tipo
    eventDidMount: function(info) {
      const type = info.event.extendedProps.type;
      const color = TYPE_COLORS[type] || "#3a87ad";
      // pinta o bloco todo
      info.el.style.backgroundColor = color;
      info.el.style.borderColor = color;
      info.el.style.color = "#fff";
    },
    eventClick: function(info) {
      selectedEvent = info.event;
      document.getElementById("type").value = info.event.extendedProps.type || "";
      document.getElementById("colaborador").value = info.event.extendedProps.colaborador || "";
      document.getElementById("startDate").value = info.event.startStr || "";
      const endInclusive = info.event.endStr ? addDaysYYYYMMDD(info.event.endStr, -1) : "";
      document.getElementById("endDate").value = endInclusive;
      document.getElementById("deleteBtn").style.display = "inline-block";
    },
    eventDrop: async function(info) {
      const ev = info.event;
      const endInclusive = ev.endStr ? addDaysYYYYMMDD(ev.endStr, -1) : ev.startStr;
      try {
        await updateEvent(ev.id, {
          title: ev.title,
          startYMD: ev.startStr,
          endYMD: endInclusive,
          type: ev.extendedProps.type || "",
          colaborador: ev.extendedProps.colaborador || ""
        });
      } catch (e) {
        console.error("Falha ao actualizar (drag):", e);
        info.revert();
      }
    },
    eventResize: async function(info) {
      const ev = info.event;
      const endInclusive = ev.endStr ? addDaysYYYYMMDD(ev.endStr, -1) : ev.startStr;
      try {
        await updateEvent(ev.id, {
          title: ev.title,
          startYMD: ev.startStr,
          endYMD: endInclusive,
          type: ev.extendedProps.type || "",
          colaborador: ev.extendedProps.colaborador || ""
        });
      } catch (e) {
        console.error("Falha ao actualizar (resize):", e);
        info.revert();
      }
    }
  });
  calendar.render();

  // Real-time: carrega e renderiza
  const q = query(eventsCol, orderBy("start", "asc"));
  onSnapshot(q, (snap) => {
    eventsCache = snap.docs.map(docToEvent);
    applyFilters();
  });

  // FILTROS
  function applyFilters() {
    const filterType = document.getElementById("filterType").value;
    const filterColab = document.getElementById("filterColab").value;

    const filtered = eventsCache.filter(ev => {
      if (filterType && ev.extendedProps.type !== filterType) return false;
      if (filterColab && ev.extendedProps.colaborador !== filterColab) return false;
      return true;
    });

    calendar.removeAllEvents();
    calendar.addEventSource(filtered);
  }
  document.getElementById("filterType").addEventListener("change", applyFilters);
  document.getElementById("filterColab").addEventListener("change", applyFilters);

  // FORM: criar/editar
  document.getElementById("eventForm").addEventListener("submit", async function(e) {
    e.preventDefault();
    const type = document.getElementById("type").value;
    const colaborador = document.getElementById("colaborador").value;
    const startYMD = document.getElementById("startDate").value;
    const endYMD = document.getElementById("endDate").value;

    if (!type || !colaborador || !startYMD || !endYMD) {
      alert("Preencha todos os campos.");
      return;
    }

    const payload = {
      title: `${type} - ${colaborador}`,       // título simples: type; título + nome `${type} - ${colaborador}`
      startYMD,
      endYMD,            // inclusivo
      type,
      colaborador
    };

    try {
      if (selectedEvent && selectedEvent.id) {
        await updateEvent(selectedEvent.id, payload);
        selectedEvent = null;
      } else {
        await createEvent(payload);
      }
      this.reset();
      document.getElementById("deleteBtn").style.display = "none";
    } catch (err) {
      console.error("Erro ao guardar:", err);
      alert("Erro ao guardar o evento (ver consola).");
    }
  });

  // APAGAR
  document.getElementById("deleteBtn").addEventListener("click", async function() {
    if (selectedEvent && confirm("Deseja apagar este evento?")) {
      try {
        await removeEvent(selectedEvent.id);
        selectedEvent = null;
        document.getElementById("eventForm").reset();
        document.getElementById("deleteBtn").style.display = "none";
      } catch (err) {
        console.error("Erro ao apagar:", err);
        alert("Erro ao apagar (ver consola).");
      }
    }
  });
});
