window.repairs = [];

const statusClass = value => ({
    'In diagnosis': 'diagnosis',
    'Waiting on parts': 'parts',
    'In repair': 'in-repair',
    'Ready for pickup': 'ready'
}[value] || '');

const list = document.querySelector('#repair-list');
const table = document.querySelector('#repair-table');

async function loadRepairs() {

    if (!window.supabaseClient) {
        console.error('Supabase client not initialized');
        return;
    }

    const {
        data,
        error
    } = await window.supabaseClient
        .from('repair_tickets')
        .select(`
            *,
            customers (
                first_name,
                last_name
            ),
            devices (
                model
            ),
            profiles:assigned_user_id (
                display_name
            )
        `)
        .order('ticket_number', {
            ascending: false
        });


    if (error) {
        console.error('Repair load failed:', error);
        return;
    }


    window.repairs = (data || []).map(ticket => ({

        id: ticket.ticket_number,

        customer: ticket.customers
            ? `${ticket.customers.first_name || ''} ${ticket.customers.last_name || ''}`.trim()
            : 'Unknown',

        device:
            ticket.devices?.model || 'Unknown device',

        service:
            ticket.customer_issue || 'No service listed',

        tech:
            ticket.profiles?.display_name || '—',

        status:
            ticket.status || 'In diagnosis',

        updated:
            ticket.updated_at
                ? new Date(ticket.updated_at).toLocaleString()
                : 'Recently updated',

        icon:
            '▯'
    }));


    renderRepairs();
}



function renderRepairs(items = window.repairs) {

    if (!Array.isArray(items)) {
        items = [];
    }


    if (list) {

        list.innerHTML = items.map(r => `

            <div class="repair-row" data-ticket="${r.id}">

                <div class="device-icon">
                    ${r.icon}
                </div>

                <div class="repair-customer">

                    <strong>
                        ${r.customer}
                    </strong>

                    <small>
                        ${r.device} · ${r.service}
                    </small>

                </div>

                <div class="repair-tech">
                    ${r.tech}
                </div>


                <span class="status ${statusClass(r.status)}">
                    ${r.status}
                </span>


                <div class="ticket-id">
                    ${r.id}<br>
                    ${r.updated}
                </div>

            </div>

        `).join('');

    }



    if (table) {

        table.innerHTML = items.map(r => `

            <tr data-ticket="${r.id}">

                <td>
                    <strong>${r.id}</strong>
                    <small>${r.updated}</small>
                </td>


                <td>
                    <strong>${r.customer}</strong>
                    <small>${r.device}</small>
                </td>


                <td>
                    ${r.service}
                </td>


                <td>
                    ${r.tech}
                </td>


                <td>
                    <span class="status ${statusClass(r.status)}">
                        ${r.status}
                    </span>
                </td>


                <td>
                    ${r.updated}
                </td>

            </tr>

        `).join('');

    }


    const count = document.querySelector('#repair-count');

    if (count) {

        count.textContent =
            window.repairs.filter(
                r => r.status !== 'Ready for pickup'
            ).length;

    }

}



function filterRepairs() {

    const search =
        document.querySelector('#repair-search')?.value
        .toLowerCase() || '';


    const status =
        document.querySelector('#status-filter')?.value || 'all';


    renderRepairs(

        window.repairs.filter(r =>

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
            .forEach(view => {

                view.classList.toggle(
                    'active-view',
                    view.id === id
                );

            });



        document.querySelectorAll('.nav-link')
            .forEach(nav => {

                nav.classList.toggle(
                    'active',
                    nav.dataset.view === id
                );

            });



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



const modal =
document.querySelector('#new-ticket');



document.querySelectorAll('[data-open-ticket]')
.forEach(button => {

    button.addEventListener(
        'click',
        () => {

            if (modal) {
                modal.showModal();
            }

        }
    );

});



const ticketForm =
document.querySelector('#ticket-form');


if (ticketForm) {

    ticketForm.addEventListener(
        'submit',
        async event => {

            event.preventDefault();

            console.log(
                'Ticket creation wiring coming next.'
            );

        }
    );

}



document.querySelector('.mobile-menu')
?.addEventListener(
    'click',
    () => {

        document
        .querySelector('.sidebar')
        ?.classList.toggle('open');

    }
);



loadRepairs();
