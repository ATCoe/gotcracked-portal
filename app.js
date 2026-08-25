(() => {
    'use strict';

    console.log('APP.JS LOADED');

    const supabase = window.supabaseClient;

    if (!supabase) {
        console.error('SUPABASE CLIENT NOT FOUND');
        return;
    }

    let repairs = [];

    const statusClass = value => ({
        'In diagnosis': 'diagnosis',
        'Waiting on parts': 'parts',
        'In repair': 'in-repair',
        'Ready for pickup': 'ready'
    }[value] || '');

    const list = document.querySelector('#repair-list');
    const table = document.querySelector('#repair-table');

    function renderRepairs(items = repairs) {
        if (!Array.isArray(items)) {
            items = [];
        }

        if (list) {
            list.innerHTML = items.map(r => `
                <div class="repair-row" data-ticket="${r.id}">
                    <div class="device-icon">${r.icon || '▯'}</div>

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

        if (count) {
            count.textContent = repairs.filter(
                r => r.status !== 'Ready for pickup'
            ).length;
        }
    }

    async function loadRepairs() {
        if (!supabase) {
            return;
        }

        try {
            /*
             * IMPORTANT:
             * Do not join customers/devices/profiles here.
             * The actual database schema does not match the relationship
             * names used by the old app.js.
             *
             * We load the repair ticket itself first.
             */

            const {
                data,
                error
            } = await supabase
                .from('repair_tickets')
                .select('*')
                .order('ticket_number', {
                    ascending: false
                });

            if (error) {
                console.error('Repair load failed:', error);
                return;
            }

            repairs = (data || []).map(ticket => ({
                id:
                    ticket.ticket_number ||
                    ticket.id ||
                    'Unknown',

                customer:
                    ticket.customer_name ||
                    ticket.customer ||
                    'Customer',

                device:
                    ticket.device_name ||
                    ticket.device ||
                    'Device',

                service:
                    ticket.customer_issue ||
                    ticket.service ||
                    'Repair',

                tech:
                    ticket.assigned_user_name ||
                    ticket.tech ||
                    '—',

                status:
                    ticket.status ||
                    'In diagnosis',

                updated:
                    ticket.updated_at
                        ? new Date(ticket.updated_at).toLocaleString()
                        : 'Recently updated',

                icon:
                    '▯'
            }));

            renderRepairs();

            console.log(
                'REPAIRS LOADED:',
                repairs.length
            );

        } catch (error) {
            console.error(
                'Repair load exception:',
                error
            );
        }
    }

    function filterRepairs() {
        const searchElement =
            document.querySelector('#repair-search');

        const statusElement =
            document.querySelector('#status-filter');

        const q =
            searchElement?.value?.toLowerCase() || '';

        const s =
            statusElement?.value || 'all';

        const filtered = repairs.filter(r => {
            const matchesStatus =
                s === 'all' ||
                r.status === s;

            const matchesSearch =
                Object.values(r)
                    .join(' ')
                    .toLowerCase()
                    .includes(q);

            return matchesStatus && matchesSearch;
        });

        renderRepairs(filtered);
    }

    const search =
        document.querySelector('#repair-search');

    if (search) {
        search.addEventListener(
            'input',
            filterRepairs
        );
    }

    const filter =
        document.querySelector('#status-filter');

    if (filter) {
        filter.addEventListener(
            'change',
            filterRepairs
        );
    }

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

                    window.location.hash = id;
                }
            );

        });

    const modal =
        document.querySelector('#new-ticket');

    document
        .querySelectorAll('[data-open-ticket]')
        .forEach(button => {

            button.addEventListener(
                'click',
                event => {

                    event.preventDefault();

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
                    'Ticket creation will be connected next.'
                );

            }
        );
    }

    const detailModal =
        document.querySelector('#ticket-detail');

    function showTicket(ticketId) {

        const ticket =
            repairs.find(
                r => String(r.id) === String(ticketId)
            );

        if (!ticket || !detailModal) {
            return;
        }

        const content =
            document.querySelector(
                '#ticket-detail-content'
            );

        if (!content) {
            return;
        }

        content.innerHTML = `
            <div class="modal-head">
                <div>
                    <p class="eyebrow">${ticket.id}</p>
                    <h2>${ticket.customer}'s repair</h2>
                </div>

                <button
                    class="icon-button"
                    id="close-ticket"
                    type="button">
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

        const closeButton =
            document.querySelector('#close-ticket');

        if (closeButton) {
            closeButton.addEventListener(
                'click',
                () => detailModal.close(),
                { once: true }
            );
        }
    }

    document.addEventListener(
        'click',
        event => {

            const row =
                event.target.closest(
                    '[data-ticket]'
                );

            if (row) {
                showTicket(
                    row.dataset.ticket
                );
            }

        }
    );

    const mobileMenu =
        document.querySelector('.mobile-menu');

    if (mobileMenu) {
        mobileMenu.addEventListener(
            'click',
            () => {

                const sidebar =
                    document.querySelector(
                        '.sidebar'
                    );

                if (sidebar) {
                    sidebar.classList.toggle(
                        'open'
                    );
                }

            }
        );
    }

    /*
     * Load repairs only after the page is initialized.
     * A failure here MUST NOT interfere with authentication.
     */

    loadRepairs();

})();
