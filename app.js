(() => {
    'use strict';

    const statusClass = value => ({
        'In diagnosis': 'diagnosis',
        'Waiting on parts': 'parts',
        'In repair': 'in-repair',
        'Ready for pickup': 'ready'
    }[value] || '');

    const list = document.querySelector('#repair-list');
    const table = document.querySelector('#repair-table');

    function getRepairs() {
        return Array.isArray(window.GotCrackedRepairs)
            ? window.GotCrackedRepairs
            : [];
    }

    function renderRepairs(items = getRepairs()) {
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
                        ${r.icon || '▯'}
                    </div>

                    <div class="repair-customer">
                        <strong>
                            ${r.customer || 'Unknown customer'}
                        </strong>

                        <small>
                            ${r.device || 'Unknown device'}
                            ·
                            ${r.service || 'No service listed'}
                        </small>
                    </div>

                    <div class="repair-tech">
                        ${r.tech || '—'}
                    </div>

                    <span
                        class="status ${statusClass(r.status)}"
                    >
                        ${r.status || 'In diagnosis'}
                    </span>

                    <div class="ticket-id">
                        ${r.id || '—'}<br>
                        ${r.updated || 'Recently updated'}
                    </div>
                </div>
            `).join('');
        }

        if (table) {
            table.innerHTML = items.map(r => `
                <tr data-ticket="${r.id}">
                    <td>
                        <strong>
                            ${r.id || '—'}
                        </strong>

                        <small>
                            ${r.updated || 'Recently updated'}
                        </small>
                    </td>

                    <td>
                        <strong>
                            ${r.customer || 'Unknown customer'}
                        </strong>

                        <small>
                            ${r.device || 'Unknown device'}
                        </small>
                    </td>

                    <td>
                        ${r.service || 'No service listed'}
                    </td>

                    <td>
                        ${r.tech || '—'}
                    </td>

                    <td>
                        <span
                            class="status ${statusClass(r.status)}"
                        >
                            ${r.status || 'In diagnosis'}
                        </span>
                    </td>

                    <td>
                        ${r.updated || 'Recently updated'}
                    </td>
                </tr>
            `).join('');
        }

        const count = document.querySelector('#repair-count');

        if (count) {
            count.textContent = getRepairs()
                .filter(r => r.status !== 'Ready for pickup')
                .length;
        }
    }

    function filterRepairs() {
        const searchElement =
            document.querySelector('#repair-search');

        const statusElement =
            document.querySelector('#status-filter');

        const query =
            searchElement?.value?.trim().toLowerCase() || '';

        const status =
            statusElement?.value || 'all';

        const filtered = getRepairs().filter(repair => {

            const matchesStatus =
                status === 'all' ||
                repair.status === status;

            const searchableText =
                Object.values(repair)
                    .join(' ')
                    .toLowerCase();

            return matchesStatus &&
                searchableText.includes(query);
        });

        renderRepairs(filtered);
    }

    function showTicket(ticketId) {
        const repairs = getRepairs();

        const ticket = repairs.find(
            repair => String(repair.id) === String(ticketId)
        );

        if (!ticket) {
            return;
        }

        const detailModal =
            document.querySelector('#ticket-detail');

        const detailContent =
            document.querySelector('#ticket-detail-content');

        if (!detailModal || !detailContent) {
            return;
        }

        detailContent.innerHTML = `
            <div class="modal-head">
                <div>
                    <p class="eyebrow">
                        ${ticket.id}
                    </p>

                    <h2>
                        ${ticket.customer || 'Customer'}'s repair
                    </h2>
                </div>

                <button
                    class="icon-button"
                    id="close-ticket"
                    type="button"
                    aria-label="Close"
                >
                    ×
                </button>
            </div>

            <span
                class="status ${statusClass(ticket.status)}"
            >
                ${ticket.status || 'In diagnosis'}
            </span>

            <div class="ticket-detail">

                <div class="detail-row">
                    <span>Device</span>
                    <strong>
                        ${ticket.device || 'Unknown device'}
                    </strong>
                </div>

                <div class="detail-row">
                    <span>Service</span>
                    <strong>
                        ${ticket.service || 'No service listed'}
                    </strong>
                </div>

                <div class="detail-row">
                    <span>Technician</span>
                    <strong>
                        ${ticket.tech || '—'}
                    </strong>
                </div>

                <div class="detail-row">
                    <span>Status</span>
                    <strong>
                        ${ticket.status || 'In diagnosis'}
                    </strong>
                </div>

                <div class="detail-row">
                    <span>Last updated</span>
                    <strong>
                        ${ticket.updated || 'Recently updated'}
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

    /*
     * Navigation
     */

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

    /*
     * Search / filter
     */

    document
        .querySelector('#repair-search')
        ?.addEventListener(
            'input',
            filterRepairs
        );

    document
        .querySelector('#status-filter')
        ?.addEventListener(
            'change',
            filterRepairs
        );

    /*
     * New ticket modal
     */

    const ticketModal =
        document.querySelector('#new-ticket');

    document
        .querySelectorAll('[data-open-ticket]')
        .forEach(button => {

            button.addEventListener(
                'click',
                event => {

                    event.preventDefault();

                    if (ticketModal) {
                        ticketModal.showModal();
                    }
                }
            );
        });

    /*
     * Ticket rows
     */

    document.addEventListener(
        'click',
        event => {

            const row =
                event.target.closest('[data-ticket]');

            if (!row) {
                return;
            }

            showTicket(row.dataset.ticket);
        }
    );

    /*
     * Mobile menu
     */

    document
        .querySelector('.mobile-menu')
        ?.addEventListener(
            'click',
            () => {

                document
                    .querySelector('.sidebar')
                    ?.classList.toggle('open');

            }
        );

    /*
     * Public UI API
     *
     * workflow.js uses this instead of
     * defining its own renderRepairs().
     */

    window.GotCrackedUI = {
        renderRepairs,
        filterRepairs,
        showTicket
    };

    console.log('APP.JS LOADED');
})();
