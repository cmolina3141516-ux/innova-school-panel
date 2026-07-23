const STORE_URL = "https://virtualplanet3.mitiendanube.com/productos/profesores-especialistas-con-i-a-er4s7/";
const WHATSAPP_NUMBER = "573013364867";
const WHATSAPP_MESSAGE = [
  "Hola, solicito acceso a Innova School.",
  "",
  "Nombre:",
  "Grado:",
  "Correo:",
  "Adjunto comprobante de pago."
].join("\n");

const storeLinks = document.querySelectorAll("[data-store-link]");
const whatsappLinks = document.querySelectorAll("[data-whatsapp-link]");
const selectionSummary = document.querySelector("#selectionSummary");
const teacherButtons = document.querySelectorAll("[data-select]");
const selectedTeachers = new Set();

storeLinks.forEach((link) => {
  link.href = STORE_URL;
});

whatsappLinks.forEach((link) => {
  link.href = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(WHATSAPP_MESSAGE)}`;
});

function renderSelection() {
  if (!selectionSummary) return;

  if (selectedTeachers.size === 0) {
    selectionSummary.textContent = "Ningún profesor seleccionado aún";
    return;
  }

  selectionSummary.textContent = Array.from(selectedTeachers).join(", ");
}

teacherButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const teacher = button.dataset.select;
    const card = button.closest(".teacher-card");

    if (selectedTeachers.has(teacher)) {
      selectedTeachers.delete(teacher);
      card?.classList.remove("is-selected");
      button.textContent = teacher.includes("Profesora") || teacher.includes("Miss")
        ? "Seleccionar profesora"
        : "Seleccionar profesor";
    } else {
      selectedTeachers.add(teacher);
      card?.classList.add("is-selected");
      button.textContent = "Seleccionado";
    }

    renderSelection();
  });
});

renderSelection();
