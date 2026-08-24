let repairs = Array.isArray(window.repairs)
    ? window.repairs
    : [];

const statusClass = value => ({
    'In diagnosis':'diagnosis',
    'Waiting on parts':'parts',
    'In repair':'in-repair',
    'Ready for pickup':'ready'
}[value] || '');

const repairListElement = document.querySelector('#repair-list');
const repairTableElement = document.querySelector('#repair-table');
const ticketModalElement = document.querySelector('#new-ticket');

async function loadRepairs() {

    const {
        data,
        error
    } = await window.supabaseClient
        .from('repair_tickets')
        .select(`
            *,
            customers (
                name
            ),
            devices (
                model
            ),
            profiles:assigned_user_id (
                display_name
            )
        `)
        .order('ticket_number', {
            ascending:false
        });


    if(error){
        console.error('Repair load failed:', error);
        return;
    }


    repairs = (data || []).map(ticket => ({
        id: ticket.ticket_number,

        customer:
            ticket.customers?.name || 'Unknown',

        device:
            ticket.devices?.model || 'Unknown device',

        service:
            ticket.customer_issue || 'No service listed',

        tech:
            ticket.profiles?.display_name || '—',

        status:
            ticket.status,

        updated:
            'Recently updated',

        icon:
            '▯'
    }));


    renderRepairs();
}


function renderRepairs(items = repairs) {

    if (!Array.isArray(items)) {
        items = [];
    }


    if (repairListElement) {
        repairListElement.innerHTML = items.map(r => `
            <div class="repair-row" data-ticket="${r.id}">
                <div class="device-icon">${r.icon}</div>

                <div class="repair-customer">
                    <strong>${r.customer}</strong>
                    <small>${r.device} · ${r.service}</small>
                </div>

                <div class="repair-tech">
                    ${r.tech}
                </div>

                <span class="status ${statusClass(r.status)}">
                    ${r.status}
                </span>

                <div class="ticket-id">
                    ${r.id}<br>${r.updated}
                </div>
            </div>
        `).join('');
    }


    if (repairTableElement) {
        repairTableElement.innerHTML = items.map(r => `
            <tr data-ticket="${r.id}">
                <td>
                    <strong>${r.id}</strong>
                    <small>${r.updated}</small>
                </td>

                <td>
                    <strong>${r.customer}</strong>
                    <small>${r.device}</small>
                </td>

                <td>${r.service}</td>
                <td>${r.tech}</td>

                <td>
                    <span class="status ${statusClass(r.status)}">
                        ${r.status}
                    </span>
                </td>

                <td>${r.updated}</td>
            </tr>
        `).join('');
    }


    const count = document.querySelector('#repair-count');

    if(count){
        count.textContent =
            repairs.filter(
                r => r.status !== 'Ready for pickup'
            ).length;
    }
}



function filterRepairs(){

    const search =
        document.querySelector('#repair-search')?.value.toLowerCase() || '';

    const status =
        document.querySelector('#status-filter')?.value || 'all';


    renderRepairs(
        repairs.filter(r =>
            (status === 'all' || r.status === status)
            &&
            Object.values(r)
            .join(' ')
            .toLowerCase()
            .includes(search)
        )
    );
}



document.querySelectorAll('[data-view]')
.forEach(link => {

    link.addEventListener('click', event => {

        event.preventDefault();

        const id = link.dataset.view;


        document.querySelectorAll('.view')
        .forEach(v =>
            v.classList.toggle(
                'active-view',
                v.id === id
            )
        );


        document.querySelectorAll('.nav-link')
        .forEach(v =>
            v.classList.toggle(
                'active',
                v.dataset.view === id
            )
        );


        window.location.hash = id;

    });

});



document.querySelector('#repair-search')
?.addEventListener(
    'input',
    filterRepairs
);


document.querySelector('#status-filter')
?.addEventListener(
    'change',
    filterRepairs
);



document.querySelectorAll('[data-open-ticket]')
.forEach(button => {

    button.addEventListener(
        'click',
        () => ticketModalElement.showModal()
    );

});



const detailModal =
    document.querySelector('#ticket-detail');


function showTicket(ticketId){

    const ticket =
        repairs.find(
            r => r.id === ticketId
        );


    if(!ticket) return;


    document.querySelector('#ticket-detail-content')
    .innerHTML = `

    <div class="modal-head">

        <div>
            <p class="eyebrow">${ticket.id}</p>
            <h2>${ticket.customer}'s repair</h2>
        </div>

        <button 
            class="icon-button"
            id="close-ticket">
            ×
        </button>

    </div>


    <span class="status ${statusClass(ticket.status)}">
        ${ticket.status}
    </span>


    <div class="ticket-detail">

        <div class="detail-row">
            <span>Device</span>
            <strong>${ticket.device}</strong>
        </div>


        <div class="detail-row">
            <span>Service</span>
            <strong>${ticket.service}</strong>
        </div>


        <div class="detail-row">
            <span>Technician</span>
            <strong>${ticket.tech}</strong>
        </div>

    </div>
    `;


    detailModal.showModal();


    document.querySelector('#close-ticket')
    ?.addEventListener(
        'click',
        () => detailModal.close()
    );

}



document.addEventListener(
    'click',
    event => {

        const row =
            event.target.closest('[data-ticket]');


        if(row){
            showTicket(row.dataset.ticket);
        }

    }
);



const loginScreen =
    document.querySelector('#login-screen');



function setStaff(staff){

    document.querySelector('#staff-name').textContent =
        staff.name;


    document.querySelector('#staff-role').textContent =
        staff.role;


    const initials =
        document.querySelector('#staff-initials');


    if(initials){

        initials.textContent =
            staff.name
            .split(' ')
            .map(p => p[0])
            .join('')
            .slice(0,2)
            .toUpperCase();

    }

}



async function loadSession(){

    const {
        data:{
            session
        }
    } =
    await window.supabaseClient.auth.getSession();


    if(!session){
        return;
    }


    await loadProfile(
        session.user.id
    );

}



async function loadProfile(userId){

    const {
        data:profile,
        error
    } =
    await window.supabaseClient
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();



    if(error){

        console.error(error);

        return;

    }



    const staff = {

        id:userId,

        name:
            profile.display_name,

        role:
            profile.role

    };


    sessionStorage.setItem(
        'gotcracked-staff',
        JSON.stringify(staff)
    );


    setStaff(staff);



    if(profile.must_change_password){

        window.location.href =
            '/setup-password.html';

        return;

    }



    loginScreen?.classList.add('hidden');

}



console.log("LOGIN HANDLER LOADED");

document.querySelector('#login-form')
?.addEventListener(
'submit',
async event => {

console.log("LOGIN SUBMIT FIRED");

    event.preventDefault();


    const email =
        document.querySelector('#login-email').value;


    const password =
        document.querySelector('#login-password').value;



    const {
        data,
        error
    } =
    await window.supabaseClient.auth.signInWithPassword({

        email,

        password

    });



    if(error){

        const message =
            document.querySelector('#login-error');


        if(message){

            message.textContent =
                error.message;

        }
        else{

            console.error(error.message);

        }


        return;

    }



    await loadProfile(
        data.user.id
    );


});



document.querySelector('#sign-out')
?.addEventListener(
'click',
async ()=>{


    await window.supabaseClient.auth.signOut();


    sessionStorage.removeItem(
        'gotcracked-staff'
    );


    loginScreen?.classList.remove(
        'hidden'
    );


});



loadSession()
    .then(() => loadRepairs());
