// === Firebase (CDN) ===
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.3/firebase-app.js";
import {
  getFirestore, collection, addDoc, doc, updateDoc, deleteDoc,
  onSnapshot, query, orderBy, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.3/firebase-firestore.js";

// 🔑 Teu config (o que enviaste)
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

// === CORES por tipo — iguais à tua legenda ===
const TYPE_COLORS = {
  "Teletrabalho": "#3498db",
  "Formação":     "#f39c12",
  "Férias":       "#2ecc71",
  "Aniversário":  "#e91e63",
  "Ponte":        "#9c27b0",
  "Outros":       "#6c757d"
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
  try { return toYYYYMMDD(new Date(value)); } catch { return ""; }
}

// ===== Firestore <-> FullCalendar =====
function docToEvent(docSnap) {
  const data = docSnap.data();
  const startYMD   = normalizeToYMD(data.start);
  const endIncYMD  = normalizeToYMD(data.end);               // inclusivo no Firestore
  const endExcYMD  = endIncYMD ? addDaysYYYYMMDD(endIncYMD, 1) : ""; // exclusivo no FC
  return {
    id: docSnap.id,
    title: data.title || `${data.type || "Evento"} - ${data.colaborador || ""}`.trim(),
    start: startYMD,
    end: endExcYMD,
    extendedProps: { type: data.type || "", colaborador: data.colaborador || "" }
  };
}

async function createEvent({ title, startYMD, endYMD, type, colaborador }) {
  const startTs = Timestamp.fromDate(new Date(`${startYMD}T00:00:00`));
  const endTs   = Timestamp.fromDate(new Date(`${endYMD}T00:00:00`));
  return addDoc(eventsCol, { title, start: startTs, end: endTs, type, colaborador });
}
async function updateEvent(id, { title, startYMD, endYMD, type, colaborador }) {
  const ref = doc(db, "events", id);
  const startTs = Timestamp.fromDate(new Date(`${startYMD}T00:00:00`));
  const endTs   = Timestamp.fromDate(new Date(`${endYMD}T00:00:00`));
  return updateDoc(ref, { title, start: startTs, end: endTs, type, colaborador });
}
async function removeEvent(id) {
  return deleteDoc(doc(db, "events", id));
}

// ===== Tooltip: posicionar modal junto do evento =====
function clamp(v, min, max){ return Math.max(min, Math.min(max, v)); }
function placeModalNearEvent(modalContentEl, eventEl){
  const rect   = eventEl.getBoundingClientRect();
  const W      = modalContentEl.offsetWidth  || 320;
  const H      = modalContentEl.offsetHeight || 220;
  const margin = 8;
  const vw     = window.innerWidth;
  const vh     = window.innerHeight;

  // preferir abrir por baixo do evento
  let top  = rect.bottom + margin;
  let left = rect.left;

  // se não couber em baixo, abrir por cima
  if (top + H > vh) top = rect.top - H - margin;

  // ajustar para não sair do ecrã
  left = clamp(left, margin, vw - W - margin);

  modalContentEl.style.top  = `${top}px`;
  modalContentEl.style.left = `${left}px`;
}

// ===== Estado =====
let eventsCache = [];
let selectedEvent = null;   // FullCalendar event
const modalEl  = document.getElementById("eventModal");
const modalBox = modalEl.querySelector(".modal-content");

// ===== App =====
document.addEventListener("DOMContentLoaded", () => {
  const calendarEl   = document.getElementById("calendar");
  const filterTypeEl = document.getElementById("filterType");
  const filterColEl  = document.getElementById("filterColab");

  // FullCalendar
  const calendar = new FullCalendar.Calendar(calendarEl, {
    initialView: "dayGridMonth",
    selectable: true,
    editable: true,
    events: [],
    select: (info) => {
      // Preencher o formulário ao selecionar uma faixa
      document.getElementById("startDate").value = info.startStr;
      document.getElementById("endDate").value   = addDaysYYYYMMDD(info.endStr, -1); // inclusivo
    },
    eventDidMount: (info) => {
      const color = TYPE_COLORS[info.event.extendedProps.type] || "#3a87ad";
      info.el.style.backgroundColor = color;
      info.el.style.borderColor     = color;
      info.el.style.color           = "#fff";
    },
    eventClick: (info) => {
      // 👉 SÓ AQUI abrimos o modal (tooltip)
      selectedEvent = info.event;

      // Preenche campos
      document.getElementById("modalType").value        = info.event.extendedProps.type || "";
      document.getElementById("modalColaborador").value = info.event.extendedProps.colaborador || "";
      document.getElementById("modalStartDate").value   = info.event.startStr;
      document.getElementById("modalEndDate").value     = info.event.endStr ? addDaysYYYYMMDD(info.event.endStr, -1) : info.event.startStr;

      // Mostra e posiciona
      modalEl.classList.remove("hidden");
      modalEl.setAttribute("aria-hidden","false");

      // Precisa estar visível para ter tamanho correto
      requestAnimationFrame(() => placeModalNearEvent(modalBox, info.el));
    },
    eventDrop: async (info) => {
      const ev = info.event;
      const endInc = ev.endStr ? addDaysYYYYMMDD(ev.endStr, -1) : ev.startStr;
      try {
        await updateEvent(ev.id, {
          title: ev.title,
          startYMD: ev.startStr,
          endYMD: endInc,
          type: ev.extendedProps.type || "",
          colaborador: ev.extendedProps.colaborador || ""
        });
      } catch (e) {
        console.error("Falha ao actualizar (drag):", e);
        info.revert();
      }
    },
    eventResize: async (info) => {
      const ev = info.event;
      const endInc = ev.endStr ? addDaysYYYYMMDD(ev.endStr, -1) : ev.startStr;
      try {
        await updateEvent(ev.id, {
          title: ev.title,
          startYMD: ev.startStr,
          endYMD: endInc,
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

  // Snapshot ao vivo
  const q = query(eventsCol, orderBy("start", "asc"));
  onSnapshot(q, (snap) => {
    eventsCache = snap.docs.map(docToEvent);
    applyFilters();
  }, (err) => {
    console.error("Erro ao ler eventos:", err);
    alert("Não foi possível ler os eventos — ver regras do Firestore e firebaseConfig.");
  });

  function applyFilters() {
    const t = filterTypeEl.value; // "" = Todos
    const c = filterColEl.value;  // "" = Todos
    const filtered = eventsCache.filter(ev => {
      const okT = !t || ev.extendedProps.type === t;
      const okC = !c || ev.extendedProps.colaborador === c;
      return okT && okC;
    });
    calendar.removeAllEvents();
    calendar.addEventSource(filtered);
  }
  filterTypeEl.addEventListener("change", applyFilters);
  filterColEl.addEventListener("change", applyFilters);

  // Criar evento
  document.getElementById("eventForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const type = document.getElementById("type").value;
    const col  = document.getElementById("colaborador").value;
    const s    = document.getElementById("startDate").value;
    const eYMD = document.getElementById("endDate").value;

    if (!type || !col || !s || !eYMD) { alert("Preencha todos os campos."); return; }
    //if (col === "Todos") { alert("Para criar evento, escolha um colaborador específico (não 'Todos')."); return; }

    const title = `${type} - ${col}`;
    await createEvent({ title, startYMD: s, endYMD: eYMD, type, colaborador: col });

    // reset
    e.target.reset();
    selectedEvent = null;
    document.getElementById("deleteBtn").style.display = "none";
  });

  // ===== Controlo do modal (fechar/guardar/apagar) =====
  const mClose  = document.querySelector("#eventModal .close");
  const mSave   = document.getElementById("modalSave");
  const mDelete = document.getElementById("modalDelete");

  function closeModal(){
    modalEl.classList.add("hidden");
    modalEl.setAttribute("aria-hidden","true");
  }
  mClose.addEventListener("click", closeModal);

  // fecha ao clicar fora (mas permite clicar no evento)
  document.addEventListener("click", (e) => {
    if (modalEl.classList.contains("hidden")) return;
    const clickedInside = modalBox.contains(e.target);
    const clickedEvent  = e.target.closest && e.target.closest(".fc-event");
    if (!clickedInside && !clickedEvent) closeModal();
  });
  // fecha ao rolar/resize (evita “ficar perdido”)
  window.addEventListener("scroll", closeModal, { passive: true });
  window.addEventListener("resize", closeModal);

  // Guardar alterações
  mSave.addEventListener("click", async () => {
    if (!selectedEvent) return;
    const newType = document.getElementById("modalType").value;
    const newCol  = document.getElementById("modalColaborador").value;
    const startYMD= document.getElementById("modalStartDate").value;
    const endYMD  = document.getElementById("modalEndDate").value;

    if (!newType || !newCol || !startYMD || !endYMD) { alert("Preencha todos os campos."); return; }
    //if (newCol === "Todos") { alert("Não use 'Todos' no evento."); return; }

    const newTitle = `${newType} - ${newCol}`;
    await updateEvent(selectedEvent.id, {
      title: newTitle, startYMD, endYMD, type: newType, colaborador: newCol
    });

    // refletir no calendário
    selectedEvent.setProp("title", newTitle);
    selectedEvent.setStart(startYMD);
    selectedEvent.setEnd(addDaysYYYYMMDD(endYMD, 1)); // FC usa fim exclusivo
    selectedEvent.setExtendedProp("type", newType);
    selectedEvent.setExtendedProp("colaborador", newCol);

    closeModal();
  });

  // Remover
  mDelete.addEventListener("click", async () => {
    if (!selectedEvent) return;
    if (!confirm("Remover este evento?")) return;
    await removeEvent(selectedEvent.id);
    selectedEvent.remove();
    selectedEvent = null;
    document.getElementById("deleteBtn").style.display = "none";
    closeModal();
  });

  // Botão “Apagar selecionado” (do formulário) — remove o último evento clicado
  document.getElementById("deleteBtn").addEventListener("click", async () => {
    if (!selectedEvent) { alert("Clique primeiro num evento para selecioná-lo."); return; }
    if (!confirm("Remover este evento?")) return;
    await removeEvent(selectedEvent.id);
    selectedEvent.remove();
    selectedEvent = null;
    document.getElementById("deleteBtn").style.display = "none";
    closeModal();
  });
});
