(() => {
    'use strict';

    const nav = document.querySelector('#staff-accounts-nav');
    const rows = document.querySelector('#staff-account-rows');
    const notice = document.querySelector('#staff-admin-notice');
    const createForm = document.querySelector('#create-staff-form');
    const changePasswordForm = document.querySelector('#change-my-password-form');
    const refreshButton = document.querySelector('#refresh-staff');
    let currentStaff = null;
    let loading = false;

    const roleLabels = {
        owner: 'Owner',
        manager: 'Manager',
        technician: 'Technician',
        front_desk: 'Front desk'
    };

    function escapeHtml(value) {
        return String(value ?? '')
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#039;');
    }

    function showNotice(message, type = 'info', temporaryPassword = '') {
        if (!notice) return;

        notice.className = `staff-admin-notice ${type}`;
        notice.innerHTML = temporaryPassword
            ? `<div><strong>${escapeHtml(message)}</strong><span>This password is shown only now. Copy it before leaving this page.</span></div><code>${escapeHtml(temporaryPassword)}</code><button type="button" data-copy-password="${escapeHtml(temporaryPassword)}">Copy password</button>`
            : `<span>${escapeHtml(message)}</span>`;
    }

    function clearNotice() {
        notice?.classList.add('hidden');
        if (notice) notice.textContent = '';
    }

    async function errorMessage(error) {
        try {
            const body = await error?.context?.json();
            return body?.error || body?.message || error?.message;
        } catch {
            return error?.message || 'The account request could not be completed.';
        }
    }

    async function invoke(action, payload = {}) {
        if (!window.supabaseClient) {
            throw new Error('The portal is not connected to Supabase.');
        }

        const { data, error } = await window.supabaseClient.functions.invoke(
            'manage-staff',
            { body: { action, ...payload } }
        );

        if (error) {
            throw new Error(await errorMessage(error));
        }

        if (!data?.ok) {
            throw new Error(data?.error || 'The account request could not be completed.');
        }

        return data;
    }

    function formatDate(value) {
        if (!value) return 'Never';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return 'Never';
        return new Intl.DateTimeFormat('en-US', {
            month: 'short', day: 'numeric', year: 'numeric'
        }).format(date);
    }

    function renderAccounts(accounts) {
        if (!rows) return;

        if (!accounts.length) {
            rows.innerHTML = '<tr><td colspan="6">No staff accounts were found.</td></tr>';
            return;
        }

        rows.innerHTML = accounts.map(account => {
            const isSelf = account.id === currentStaff?.id;
            const roleOptions = Object.entries(roleLabels).map(([value, label]) =>
                `<option value="${value}" ${account.role === value ? 'selected' : ''}>${label}</option>`
            ).join('');

            return `<tr data-staff-id="${escapeHtml(account.id)}">
                <td><strong>${escapeHtml(account.displayName || 'Staff')}</strong><small>${escapeHtml(account.email || 'No login email')}</small>${isSelf ? '<em class="self-tag">You</em>' : ''}</td>
                <td><select data-staff-role ${isSelf ? 'disabled title="You cannot change your own owner role."' : ''}>${roleOptions}</select></td>
                <td><span class="access-pill ${account.active ? 'active' : 'disabled'}">${account.active ? 'Active' : 'Disabled'}</span></td>
                <td>${account.mustChangePassword ? '<span class="setup-required">Change required</span>' : '<span class="setup-complete">Private password set</span>'}</td>
                <td>${escapeHtml(formatDate(account.lastSignInAt))}</td>
                <td><div class="staff-actions">${isSelf ? '<span class="self-note">Use “Change my password” above</span>' : `<button type="button" data-reset-staff>Issue temp password</button><button type="button" data-toggle-staff data-active="${account.active}">${account.active ? 'Disable' : 'Enable'}</button>`}</div></td>
            </tr>`;
        }).join('');
    }

    async function loadAccounts() {
        if (loading || currentStaff?.role !== 'owner') return;
        loading = true;
        clearNotice();
        if (rows) rows.innerHTML = '<tr><td colspan="6">Loading staff accounts…</td></tr>';
        if (refreshButton) refreshButton.disabled = true;

        try {
            const result = await invoke('list');
            renderAccounts(result.accounts || []);
        } catch (error) {
            if (rows) rows.innerHTML = '<tr><td colspan="6">Staff accounts could not be loaded.</td></tr>';
            showNotice(error.message, 'error');
        } finally {
            loading = false;
            if (refreshButton) refreshButton.disabled = false;
        }
    }

    function enableForOwner(staff) {
        currentStaff = staff;
        const isOwner = staff?.role === 'owner';
        nav?.classList.toggle('hidden', !isOwner);
        if (isOwner && window.location.hash === '#staff-accounts') loadAccounts();
    }

    window.addEventListener('gotcracked:staff-ready', event => enableForOwner(event.detail));
    window.addEventListener('gotcracked:staff-signed-out', () => {
        currentStaff = null;
        nav?.classList.add('hidden');
    });

    if (window.GotCrackedStaff) enableForOwner(window.GotCrackedStaff);

    nav?.addEventListener('click', () => setTimeout(loadAccounts, 0));
    refreshButton?.addEventListener('click', loadAccounts);

    createForm?.addEventListener('submit', async event => {
        event.preventDefault();
        clearNotice();
        const button = createForm.querySelector('button[type="submit"]');
        const values = Object.fromEntries(new FormData(createForm));
        button.disabled = true;
        button.textContent = 'Creating…';

        try {
            const result = await invoke('create', values);
            createForm.reset();
            await loadAccounts();
            showNotice(`Account created for ${values.displayName}.`, 'success', result.temporaryPassword);
        } catch (error) {
            showNotice(error.message, 'error');
        } finally {
            button.disabled = false;
            button.textContent = 'Create account';
        }
    });

    changePasswordForm?.addEventListener('submit', async event => {
        event.preventDefault();
        clearNotice();
        const values = Object.fromEntries(new FormData(changePasswordForm));
        const button = changePasswordForm.querySelector('button[type="submit"]');

        if (values.password.length < 8) {
            showNotice('Use a password with at least 8 characters.', 'error');
            return;
        }
        if (values.password !== values.confirmation) {
            showNotice('The two passwords do not match.', 'error');
            return;
        }

        button.disabled = true;
        button.textContent = 'Updating…';
        try {
            const { error } = await window.supabaseClient.auth.updateUser({ password: values.password });
            if (error) throw error;
            changePasswordForm.reset();
            showNotice('Your password has been updated.', 'success');
        } catch (error) {
            showNotice(error.message || 'Your password could not be updated.', 'error');
        } finally {
            button.disabled = false;
            button.textContent = 'Update my password';
        }
    });

    rows?.addEventListener('click', async event => {
        const row = event.target.closest('[data-staff-id]');
        if (!row) return;
        const userId = row.dataset.staffId;

        if (event.target.closest('[data-reset-staff]')) {
            if (!window.confirm('Issue a new temporary password? Their current password will stop working immediately.')) return;
            clearNotice();
            try {
                const result = await invoke('reset_password', { userId });
                await loadAccounts();
                showNotice('Temporary password issued.', 'success', result.temporaryPassword);
            } catch (error) {
                showNotice(error.message, 'error');
            }
        }

        const toggle = event.target.closest('[data-toggle-staff]');
        if (toggle) {
            const active = toggle.dataset.active !== 'true';
            const verb = active ? 'enable' : 'disable';
            if (!window.confirm(`Are you sure you want to ${verb} this account?`)) return;
            clearNotice();
            try {
                await invoke('set_active', { userId, active });
                await loadAccounts();
                showNotice(`Account ${active ? 'enabled' : 'disabled'}.`, 'success');
            } catch (error) {
                showNotice(error.message, 'error');
            }
        }
    });

    rows?.addEventListener('change', async event => {
        if (!event.target.matches('[data-staff-role]')) return;
        const row = event.target.closest('[data-staff-id]');
        clearNotice();
        try {
            await invoke('set_role', { userId: row.dataset.staffId, role: event.target.value });
            await loadAccounts();
            showNotice('Staff role updated.', 'success');
        } catch (error) {
            showNotice(error.message, 'error');
            await loadAccounts();
        }
    });

    notice?.addEventListener('click', async event => {
        const button = event.target.closest('[data-copy-password]');
        if (!button) return;
        try {
            await navigator.clipboard.writeText(button.dataset.copyPassword);
            button.textContent = 'Copied';
        } catch {
            showNotice('Copy failed. Select the temporary password and copy it manually.', 'error');
        }
    });
})();
