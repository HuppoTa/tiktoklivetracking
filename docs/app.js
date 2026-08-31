const questions = [
  { id: 1, user: "@minhhoa.demo", name: "Minh Họa", text: "Shop có giao hàng vào cuối tuần không?", repeats: 3, answered: false, time: "2 phút trước" },
  { id: 2, user: "@nguoixem.thu", name: "Người Xem Thử", text: "Sản phẩm mẫu còn màu xanh lá không?", repeats: 1, answered: false, time: "5 phút trước" },
  { id: 3, user: "@ban.demo", name: "Bạn Demo", text: "Cách đặt hàng trong livestream như thế nào?", repeats: 2, answered: true, time: "9 phút trước" }
];
let activeTab = "pending";
const queue = document.querySelector("#queue");
const escapeHtml = value => String(value).replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
function render() {
  document.querySelector("#pending-count").textContent = `(${questions.filter(q => !q.answered).length})`;
  document.querySelector("#answered-count").textContent = `(${questions.filter(q => q.answered).length})`;
  const rows = activeTab === "users" ? questions : questions.filter(q => q.answered === (activeTab === "answered"));
  queue.innerHTML = rows.length ? rows.map(q => `<article class="question ${q.answered ? "done" : ""}"><input type="checkbox" data-id="${q.id}" ${q.answered ? "checked" : ""} aria-label="Đánh dấu đã trả bài"><div><h3>${escapeHtml(q.name)} <small>${escapeHtml(q.user)}</small></h3><p>${escapeHtml(q.text)}</p><div class="meta"><span class="tag">Lặp ${q.repeats} lần</span><span>${q.answered ? "Đã trả bài" : "Đang chờ"}</span></div></div><time>${q.time}</time></article>`).join("") : '<div class="empty">Không có câu hỏi trong mục này.</div>';
}
document.querySelector(".tabs").addEventListener("click", event => { const button = event.target.closest("button[data-tab]"); if (!button) return; activeTab = button.dataset.tab; document.querySelectorAll(".tabs button").forEach(item => item.classList.toggle("active", item === button)); render(); });
queue.addEventListener("change", event => { const checkbox = event.target.closest("input[data-id]"); if (!checkbox) return; const question = questions.find(item => item.id === Number(checkbox.dataset.id)); if (question) question.answered = checkbox.checked; render(); });
const dialog = document.querySelector("#target-dialog");
document.querySelector("#change-target").addEventListener("click", () => dialog.showModal());
document.querySelector("#save-target").addEventListener("click", event => { const input = document.querySelector("#target-input"); if (!input.checkValidity()) return; event.preventDefault(); document.querySelector("#target").textContent = `@${input.value.replace(/^@/, "")}`; dialog.close(); });
render();
