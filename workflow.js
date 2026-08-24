const storageKey = 'gotcracked-repairs';
const savedRepairs = JSON.parse(localStorage.getItem(storageKey) || 'null');
if (savedRepairs) repairs.splice(0, repairs.length, ...savedRepairs);
const persist = () => localStorage.setItem(storageKey, JSON.stringify(repairs));

renderRepairs = function (items = repairs) {
  list.innerHTML = items.map(r => `<div class="repair-row" data-ticket="${r.id}"><div class="device-icon">${r.icon}</div><div class="repair-customer"><strong>${r.customer}</strong><small>${r.device} · ${r.service}</small></div><div class="repair-tech">${r.tech}</div><span class="status ${statusClass(r.status)}">${r.status}</span><div class="ticket-id">${r.id}<br>${r.updated}</div></div>`).join('');
  table.innerHTML = items.map(r => `<tr data-ticket="${r.id}"><td><strong>${r.id}</strong><small>${r.updated}</small></td><td><strong>${r.customer}</strong><small>${r.device}</small></td><td>${r.service}</td><td>${r.tech}</td><td><span class="status ${statusClass(r.status)}">${r.status}</span></td><td>${r.updated}</td></tr>`).join('');
  document.querySelector('#repair-count').textContent = repairs.filter(r => r.status !== 'Ready for pickup').length;
};
renderRepairs();

document.querySelector('#ticket-form').addEventListener('submit', event => {
  event.preventDefault();
  event.stopImmediatePropagation();
  const data = new FormData(event.currentTarget);
  repairs.unshift({ id: `GC-${String(1049 + repairs.length).padStart(4, '0')}`, customer: data.get('customer'), phone: data.get('phone'), device: data.get('device'), service: data.get('service'), issue: data.get('issue'), tech: '—', status: 'In diagnosis', updated: 'Just now', icon: '▯' });
  persist(); renderRepairs(); event.currentTarget.reset(); modal.close(); document.querySelector('[data-view="repairs"]').click();
}, true);

const detailModal = document.querySelector('#ticket-detail');
function showTicket(ticketId) {
  const r = repairs.find(ticket => ticket.id === ticketId); if (!r) return;
  document.querySelector('#ticket-detail-content').innerHTML = `<div class="modal-head"><div><p class="eyebrow">${r.id}</p><h2>${r.customer}’s repair</h2></div><button class="icon-button" id="close-ticket" aria-label="Close">×</button></div><span class="status ${statusClass(r.status)}">${r.status}</span><div class="ticket-detail"><div class="detail-row"><span>Device</span><strong>${r.device}</strong></div><div class="detail-row"><span>Requested service</span><strong>${r.service}</strong></div><div class="detail-row"><span>Assigned technician</span><strong>${r.tech}</strong></div><div class="detail-row"><span>Customer contact</span><strong>${r.phone || 'Not yet recorded'}</strong></div><div class="detail-row"><span>Reported issue</span><strong>${r.issue || 'No notes recorded'}</strong></div></div><div class="detail-actions"><button class="secondary-button" id="advance-ticket">Advance status</button></div>`;
  detailModal.showModal();
  document.querySelector('#close-ticket').addEventListener('click', () => detailModal.close());
  document.querySelector('#advance-ticket').addEventListener('click', () => {
    const flow = ['In diagnosis', 'Waiting on parts', 'In repair', 'Ready for pickup']; const next = flow[flow.indexOf(r.status) + 1];
    if (next) { r.status = next; r.updated = 'Just now'; persist(); renderRepairs(); showTicket(ticketId); }
  });
}
document.addEventListener('click', event => { const row = event.target.closest('[data-ticket]'); if (row) showTicket(row.dataset.ticket); });

const loginScreen = document.querySelector('#login-screen');

function setStaff(staff) {
    document.querySelector('#staff-name').textContent = staff.name;
    document.querySelector('#staff-role').textContent = staff.role;

    document.querySelector('#staff-initials').textContent =
        staff.name
            .split(' ')
            .map(part => part[0])
            .join('')
            .slice(0,2)
            .toUpperCase();
}


async function loadSession() {

    const {
        data: {
            session
        }
    } = await supabaseClient.auth.getSession();


    if (!session) {
        return;
    }


    await loadProfile(session.user.id);
}



async function loadProfile(userId) {

    const {
        data: profile,
        error
    } = await supabaseClient
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();


    if (error) {
        console.error(error);
        return;
    }


    const staff = {
        id: userId,
        name: profile.display_name,
        role: profile.role
    };


    sessionStorage.setItem(
        'gotcracked-staff',
        JSON.stringify(staff)
    );


    setStaff(staff);


    if (profile.must_change_password) {

        window.location.href = '/setup-password.html';

        return;
    }


    loginScreen.classList.add('hidden');
}



document
.querySelector('#login-form')
.addEventListener('submit', async event => {

    event.preventDefault();


    const email =
        document.querySelector('#login-email').value;


    const password =
        document.querySelector('#login-password').value;



    const {
        data,
        error
    } =
    await supabaseClient.auth.signInWithPassword({

        email,

        password

    });



    if (error) {

        alert(error.message);

        return;

    }



    await loadProfile(data.user.id);

});



document
.querySelector('#sign-out')
.addEventListener('click', async () => {


    await supabaseClient.auth.signOut();


    sessionStorage.removeItem(
        'gotcracked-staff'
    );


    loginScreen.classList.remove('hidden');

});
 

loadSession();
