const repairs = [
  { id: 'GC-1048', customer: 'Maria Thompson', device: 'iPhone 14 Pro', service: 'Screen repair', tech: 'Evan R.', status: 'In repair', updated: '12 min ago', icon: '▯' },
  { id: 'GC-1047', customer: 'Jordan Lee', device: 'PlayStation 5', service: 'HDMI diagnosis', tech: '—', status: 'In diagnosis', updated: '28 min ago', icon: '▰' },
  { id: 'GC-1045', customer: 'Tori Brooks', device: 'Samsung S23 Ultra', service: 'Charge port', tech: 'Maya P.', status: 'Waiting on parts', updated: '1 hr ago', icon: '▯' },
  { id: 'GC-1044', customer: 'David Miller', device: 'MacBook Air M2', service: 'Battery service', tech: 'Evan R.', status: 'In repair', updated: '1 hr ago', icon: '▱' },
  { id: 'GC-1042', customer: 'Aisha Grant', device: 'iPad Air 5', service: 'Screen repair', tech: 'Maya P.', status: 'Ready for pickup', updated: '2 hrs ago', icon: '▯' },
];
const statusClass = value => ({ 'In diagnosis':'diagnosis', 'Waiting on parts':'parts', 'In repair':'in-repair', 'Ready for pickup':'ready' }[value]);
const list = document.querySelector('#repair-list');
const table = document.querySelector('#repair-table');
function renderRepairs(items = repairs) {
  list.innerHTML = items.map(r => `<div class="repair-row"><div class="device-icon">${r.icon}</div><div class="repair-customer"><strong>${r.customer}</strong><small>${r.device} · ${r.service}</small></div><div class="repair-tech">${r.tech}</div><span class="status ${statusClass(r.status)}">${r.status}</span><div class="ticket-id">${r.id}<br>${r.updated}</div></div>`).join('');
  table.innerHTML = items.map(r => `<tr><td><strong>${r.id}</strong><small>${r.updated}</small></td><td><strong>${r.customer}</strong><small>${r.device}</small></td><td>${r.service}</td><td>${r.tech}</td><td><span class="status ${statusClass(r.status)}">${r.status}</span></td><td>${r.updated}</td></tr>`).join('');
  document.querySelector('#repair-count').textContent = repairs.filter(r => r.status !== 'Ready for pickup').length;
}
renderRepairs();
document.querySelectorAll('[data-view]').forEach(link => link.addEventListener('click', event => { event.preventDefault(); const id = link.dataset.view; document.querySelectorAll('.view').forEach(v => v.classList.toggle('active-view', v.id === id)); document.querySelectorAll('.nav-link').forEach(v => v.classList.toggle('active', v.dataset.view === id)); window.location.hash = id; }));
document.querySelector('#repair-search').addEventListener('input', event => filterRepairs());
document.querySelector('#status-filter').addEventListener('change', filterRepairs);
function filterRepairs(){ const q = document.querySelector('#repair-search').value.toLowerCase(); const s = document.querySelector('#status-filter').value; renderRepairs(repairs.filter(r => (s === 'all' || r.status === s) && Object.values(r).join(' ').toLowerCase().includes(q))); }
const modal = document.querySelector('#new-ticket');
document.querySelectorAll('[data-open-ticket]').forEach(button => button.addEventListener('click', () => modal.showModal()));
document.querySelector('#ticket-form').addEventListener('submit', event => { event.preventDefault(); const data = new FormData(event.target); repairs.unshift({ id:`GC-${1049 + repairs.length}`, customer:data.get('customer'), device:data.get('device'), service:data.get('service'), tech:'—', status:'In diagnosis', updated:'Just now', icon:'▯' }); renderRepairs(); event.target.reset(); modal.close(); document.querySelector('[data-view="repairs"]').click(); });
document.querySelector('.mobile-menu').addEventListener('click', () => document.querySelector('.sidebar').classList.toggle('open'));
