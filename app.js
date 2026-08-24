let repairs = [];

const statusClass = value => ({
    'In diagnosis':'diagnosis',
    'Waiting on parts':'parts',
    'In repair':'in-repair',
    'Ready for pickup':'ready'
}[value]);


const list = document.querySelector('#repair-list');
const table = document.querySelector('#repair-table');


async function loadRepairs(){

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
            ticket.updated_at
                ? new Date(ticket.updated_at).toLocaleString()
                : 'Recently updated',

        icon:
            '▯'
    }));


    renderRepairs();
}



function renderRepairs(items = repairs){

    list.innerHTML = items.map(r =>
        `<div class="repair-row">
            <div class="device-icon">${r.icon}</div>
            <div class="repair-customer">
                <strong>${r.customer}</strong>
                <small>${r.device} · ${r.service}</small>
            </div>
            <div class="repair-tech">${r.tech}</div>
            <span class="status ${statusClass(r.status)}">${r.status}</span>
            <div class="ticket-id">${r.id}<br>${r.updated}</div>
        </div>`
    ).join('');


    table.innerHTML = items.map(r =>
        `<tr>
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
                <span class="status ${statusClass(r.status)}">${r.status}</span>
            </td>
            <td>${r.updated}</td>
        </tr>`
    ).join('');


    const count = document.querySelector('#repair-count');

    if(count){
        count.textContent =
            repairs.filter(r => r.status !== 'Ready for pickup').length;
    }
}



loadRepairs();



document.querySelectorAll('[data-view]').forEach(link => {

    link.addEventListener('click', event => {

        event.preventDefault();

        const id = link.dataset.view;

        document.querySelectorAll('.view')
            .forEach(v =>
                v.classList.toggle('active-view', v.id === id)
            );


        document.querySelectorAll('.nav-link')
            .forEach(v =>
                v.classList.toggle('active', v.dataset.view === id)
            );


        window.location.hash = id;

    });

});



const search = document.querySelector('#repair-search');

if(search){
    search.addEventListener('input', () => filterRepairs());
}



const filter = document.querySelector('#status-filter');

if(filter){
    filter.addEventListener('change', () => filterRepairs());
}



function filterRepairs(){

    const q =
        document.querySelector('#repair-search')
        .value
        .toLowerCase();


    const s =
        document.querySelector('#status-filter')
        .value;


    renderRepairs(
        repairs.filter(r =>
            (s === 'all' || r.status === s) &&
            Object.values(r)
            .join(' ')
            .toLowerCase()
            .includes(q)
        )
    );

}



const modal = document.querySelector('#new-ticket');


document.querySelectorAll('[data-open-ticket]')
.forEach(button => {

    button.addEventListener('click', () => {

        if(modal){
            modal.showModal();
        }

    });

});



const ticketForm = document.querySelector('#ticket-form');


if(ticketForm){

    ticketForm.addEventListener('submit', async event => {

        event.preventDefault();

        console.log(
            'Ticket creation will be connected next.'
        );

    });

}



const mobileMenu = document.querySelector('.mobile-menu');


if(mobileMenu){

    mobileMenu.addEventListener('click', () => {

        document
        .querySelector('.sidebar')
        .classList.toggle('open');

    });

}
