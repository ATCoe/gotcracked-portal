(() => {
    'use strict';

    const statusClass = value => ({
        'In diagnosis': 'diagnosis',
        'Waiting on parts': 'parts',
        'In repair': 'in-repair',
        'Ready for pickup': 'ready'
    }[value] || '');

    const escapeHtml = value => String(value ?? '').replace(
        /[&<>"']/g,
        character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character])
    );

    let linkedTicketOpened = false;

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

        openLinkedTicket();
    }

    function openLinkedTicket() {
        if (linkedTicketOpened) return;
        const ticketId = new URLSearchParams(window.location.search).get('ticket');
        if (!ticketId || !getRepairs().some(repair => String(repair.id) === ticketId)) return;
        linkedTicketOpened = true;
        document.querySelectorAll('.view').forEach(view => view.classList.toggle('active-view', view.id === 'repairs'));
        document.querySelectorAll('.nav-link').forEach(link => link.classList.toggle('active', link.dataset.view === 'repairs'));
        showTicket(ticketId);
    }

    function printDeviceLabel(ticket) {
        document.querySelector('#device-label-print')?.remove();
        const label = document.createElement('section');
        label.id = 'device-label-print';
        label.className = 'device-label-print';
        label.setAttribute('aria-hidden', 'true');
        label.innerHTML = `
            <div class="label-copy">
                <div class="label-brand">GOTCRACKED · WORK ORDER</div>
                <div class="label-ticket">${escapeHtml(ticket.id || 'Ticket pending')}</div>
                <div class="label-customer">${escapeHtml(ticket.customer || 'Customer')}</div>
                <div class="label-device">${escapeHtml(ticket.device || 'Device pending')}</div>
                <div class="label-date">Printed ${new Date().toLocaleString()}</div>
            </div>
            <div><div class="label-qr" id="label-qr"></div><div class="label-scan">SCAN TO OPEN WORK ORDER</div></div>
        `;
        document.body.appendChild(label);

        const workOrderUrl = new URL('/', 'https://portal.gotcracked.co');
        workOrderUrl.searchParams.set('ticket', ticket.id || '');
        if (window.QRCode) {
            new window.QRCode(document.querySelector('#label-qr'), {
                text: workOrderUrl.toString(),
                width: 180,
                height: 180,
                correctLevel: window.QRCode.CorrectLevel.H
            });
        } else {
            document.querySelector('#label-qr').textContent = ticket.id || '';
        }

        const cleanUp = () => {
            document.body.classList.remove('printing-device-label');
            label.remove();
            window.removeEventListener('afterprint', cleanUp);
        };
        window.addEventListener('afterprint', cleanUp);
        document.body.classList.add('printing-device-label');
        setTimeout(() => window.print(), 120);
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

            <button class="primary-button label-print-button" id="print-device-label" type="button">
                ▣ Print device label
            </button>
        `;

        detailModal.showModal();

        document
            .querySelector('#close-ticket')
            ?.addEventListener(
                'click',
                () => detailModal.close()
            );

        document
            .querySelector('#print-device-label')
            ?.addEventListener('click', () => printDeviceLabel(ticket));
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
