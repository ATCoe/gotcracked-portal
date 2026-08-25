// GotCracked Portal
// app.js
// Repair data and repair UI only.
// Authentication/session handling lives in workflow.js.

window.repairs = [];

let repairsLoading = false;

const statusClass = value => ({
    'In diagnosis': 'diagnosis',
    'Waiting on parts': 'parts',
    'In repair': 'in-repair',
    'Ready for pickup': 'ready'
}[value] || '');

const list = document.querySelector('#repair-list');
const table = document.querySelector('#repair-table');
const modal = document.querySelector('#new-ticket');
const ticketForm = document.querySelector('#ticket-form');


// ============================================================
// LOAD REPAIRS
// ============================================================

async function loadRepairs() {

    if (!window.supabaseClient) {
        console.error('Supabase client is not available.');
        return;
    }

    if (repairsLoading) {
        return;
    }

    repairsLoading = true;

    try {

        // Never query repair data while anonymous.
        const {
            data: {
                session
            }
        } = await window.supabaseClient.auth.getSession();

        if (!session) {
            window.repairs = [];
            renderRepairs();
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
                    last_name,
                    phone,
                    email
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

            console.error(
                'Repair load failed:',
                error
            );

            return;
        }


        window.repairs = (data || []).map(ticket => {

            const customer = ticket.customers;

            const customerName = customer
                ? [
                    customer.first_name,
                    customer.last_name
                ]
                    .filter(Boolean)
                    .join(' ')
                : 'Unknown';


            return {

                id:
                    ticket.ticket_number,

                customer:
                    customerName || 'Unknown',

                phone:
                    customer?.phone || '',

                email:
                    customer?.email || '',

                device:
                    ticket.devices?.model ||
                    'Unknown device',

                service:
                    ticket.customer_issue ||
                    'No service listed',

                issue:
                    ticket.customer_issue ||
                    '',

                tech:
                    ticket.profiles?.display_name ||
                    '—',

                status:
                    ticket.status ||
                    'In diagnosis',

                updated:
                    ticket.updated_at
                        ? new Date(
                            ticket.updated_at
                        ).toLocaleString()
                        : 'Recently updated',

                icon:
                    '▯'

            };

        });


        renderRepairs();

    } finally {

        repairsLoading = false;

    }
}


// ============================================================
// RENDER REPAIRS
// ============================================================

function renderRepairs(items = window.repairs) {

    if (!Array.isArray(items)) {
        items = [];
    }


    if (list) {

        list.innerHTML = items.map(r => `

            <div
                class="repair-row"
                data-ticket="${r.id}"
            >

                <div class="device-icon">
                    ${r.icon}
                </div>


                <div class="repair-customer">

                    <strong>
                        ${r.customer}
                    </strong>

                    <small>
                        ${r.device}
                        ·
                        ${r.service}
                    </small>

                </div>


                <div class="repair-tech">
                    ${r.tech}
                </div>


                <span
                    class="status ${statusClass(r.status)}"
                >
                    ${r.status}
                </span>


                <div class="ticket-id">

                    ${r.id}

                    <br>

                    ${r.updated}

                </div>

            </div>

        `).join('');

    }


    if (table) {

        table.innerHTML = items.map(r => `

            <tr
                data-ticket="${r.id}"
            >

                <td>

                    <strong>
                        ${r.id}
                    </strong>

                    <small>
                        ${r.updated}
                    </small>

                </td>


                <td>

                    <strong>
                        ${r.customer}
                    </strong>

                    <small>
                        ${r.device}
                    </small>

                </td>


                <td>
                    ${r.service}
                </td>


                <td>
                    ${r.tech}
                </td>


                <td>

                    <span
                        class="status ${statusClass(r.status)}"
                    >
                        ${r.status}
                    </span>

                </td>


                <td>
                    ${r.updated}
                </td>

            </tr>

        `).join('');

    }


    const count =
        document.querySelector('#repair-count');


    if (count) {

        count.textContent =
            window.repairs.filter(
                r =>
                    r.status !==
                    'Ready for pickup'
            ).length;

    }

}


// ============================================================
// FILTER REPAIRS
// ============================================================

function filterRepairs() {

    const searchInput =
        document.querySelector('#repair-search');

    const statusFilter =
        document.querySelector('#status-filter');


    const q =
        searchInput?.value
            ?.toLowerCase()
            .trim() || '';


    const s =
        statusFilter?.value ||
        'all';


    const filtered =
        window.repairs.filter(r => {

            const matchesStatus =
                s === 'all' ||
                r.status === s;


            const searchable =
                Object.values(r)
                    .join(' ')
                    .toLowerCase();


            const matchesSearch =
                !q ||
                searchable.includes(q);


            return (
                matchesStatus &&
                matchesSearch
            );

        });


    renderRepairs(filtered);

}


// ============================================================
// NAVIGATION
// ============================================================

document
    .querySelectorAll('[data-view]')
    .forEach(link => {

        link.addEventListener(
            'click',
            event => {

                event.preventDefault();


                const id =
                    link.dataset.view;


                document
                    .querySelectorAll('.view')
                    .forEach(view => {

                        view.classList.toggle(
                            'active-view',
                            view.id === id
                        );

                    });


                document
                    .querySelectorAll('.nav-link')
                    .forEach(nav => {

                        nav.classList.toggle(
                            'active',
                            nav.dataset.view === id
                        );

                    });


                window.location.hash =
                    id;

            }
        );

    });


// ============================================================
// SEARCH
// ============================================================

const search =
    document.querySelector(
        '#repair-search'
    );


if (search) {

    search.addEventListener(
        'input',
        filterRepairs
    );

}


// ============================================================
// STATUS FILTER
// ============================================================

const filter =
    document.querySelector(
        '#status-filter'
    );


if (filter) {

    filter.addEventListener(
        'change',
        filterRepairs
    );

}


// ============================================================
// NEW TICKET MODAL
// ============================================================

document
    .querySelectorAll('[data-open-ticket]')
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


// ============================================================
// TICKET DETAILS
// ============================================================

const detailModal =
    document.querySelector(
        '#ticket-detail'
    );


function showTicket(ticketId) {

    const ticket =
        window.repairs.find(
            r =>
                String(r.id) ===
                String(ticketId)
        );


    if (!ticket) {
        return;
    }


    const content =
        document.querySelector(
            '#ticket-detail-content'
        );


    if (!content || !detailModal) {
        return;
    }


    content.innerHTML = `

        <div class="modal-head">

            <div>

                <p class="eyebrow">
                    ${ticket.id}
                </p>

                <h2>
                    ${ticket.customer}'s repair
                </h2>

            </div>


            <button
                class="icon-button"
                id="close-ticket"
                aria-label="Close"
                type="button"
            >
                ×
            </button>

        </div>


        <span
            class="status ${statusClass(ticket.status)}"
        >
            ${ticket.status}
        </span>


        <div class="ticket-detail">

            <div class="detail-row">

                <span>
                    Device
                </span>

                <strong>
                    ${ticket.device}
                </strong>

            </div>


            <div class="detail-row">

                <span>
                    Requested service
                </span>

                <strong>
                    ${ticket.service}
                </strong>

            </div>


            <div class="detail-row">

                <span>
                    Assigned technician
                </span>

                <strong>
                    ${ticket.tech}
                </strong>

            </div>


            <div class="detail-row">

                <span>
                    Customer contact
                </span>

                <strong>
                    ${ticket.phone ||
                    ticket.email ||
                    'Not yet recorded'}
                </strong>

            </div>


            <div class="detail-row">

                <span>
                    Reported issue
                </span>

                <strong>
                    ${ticket.issue ||
                    'No notes recorded'}
                </strong>

            </div>

        </div>

    `;


    detailModal.showModal();


    document
        .querySelector('#close-ticket')
        ?.addEventListener(
            'click',
            () => detailModal.close()
        );

}


// ============================================================
// TICKET CLICK HANDLER
// ============================================================

document.addEventListener(
    'click',
    event => {

        const row =
            event.target.closest(
                '[data-ticket]'
            );


        if (!row) {
            return;
        }


        showTicket(
            row.dataset.ticket
        );

    }
);


// ============================================================
// NEW TICKET FORM
// ============================================================

if (ticketForm) {

    ticketForm.addEventListener(
        'submit',
        async event => {

            event.preventDefault();


            console.log(
                'Ticket creation will be connected next.'
            );

        }
    );

}


// ============================================================
// MOBILE MENU
// ============================================================

const mobileMenu =
    document.querySelector(
        '.mobile-menu'
    );


if (mobileMenu) {

    mobileMenu.addEventListener(
        'click',
        () => {

            document
                .querySelector('.sidebar')
                ?.classList.toggle(
                    'open'
                );

        }
    );

}


// ============================================================
// AUTH STATE
// ============================================================

if (window.supabaseClient) {

    window.supabaseClient.auth
        .onAuthStateChange(
            async (event, session) => {

                if (
                    event === 'SIGNED_IN' &&
                    session
                ) {

                    await loadRepairs();

                    return;
                }


                if (
                    event === 'INITIAL_SESSION' &&
                    session
                ) {

                    await loadRepairs();

                    return;
                }


                if (
                    event === 'SIGNED_OUT'
                ) {

                    window.repairs = [];

                    renderRepairs();

                }

            }
        );

}


// ============================================================
// INITIAL AUTH-AWARE LOAD
// ============================================================

(async function initializeRepairs() {

    if (!window.supabaseClient) {
        console.error(
            'Supabase client is not available.'
        );
        return;
    }


    const {
        data: {
            session
        }
    } =
        await window.supabaseClient.auth.getSession();


    if (session) {

        await loadRepairs();

    } else {

        // Anonymous users should see no repair data.
        window.repairs = [];

        renderRepairs();

    }

})();
