(() => {
    'use strict';

    console.log('WORKFLOW.JS LOADED');

    /*
     * Single source of truth for repairs.
     *
     * app.js reads this array.
     * workflow.js owns the data.
     */

    window.GotCrackedRepairs = [];

    const repairStatusLabels = {
        checked_in: 'Checked in (legacy)', in_diagnosis: 'In diagnosis (legacy)', awaiting_approval: 'Awaiting approval (legacy)', waiting_on_parts: 'Waiting on parts (legacy)', in_repair: 'In repair (legacy)', ready_for_pickup: 'Ready for pickup (legacy)', completed: 'Completed (legacy)',
        awaiting_repair: 'Awaiting Repair', need_to_order_parts: 'Need to Order Parts', awaiting_parts: 'Awaiting Parts', diagnostic_in_progress: 'Diagnostic in Progress', repair_in_progress: 'Repair in Progress', quality_inspection: 'Quality Inspection', awaiting_callback: 'Awaiting Callback', repaired: 'Repaired – Ready for Pickup', sale_complete: 'Sale Complete', abandoned: 'Abandoned', unrepairable: 'Unrepairable', customer_declined: 'Customer Declined', cancelled: 'Cancelled'
    };

    const loginScreen =
        document.querySelector('#login-screen');

    const loginForm =
        document.querySelector('#login-form');

    const loginEmail =
        document.querySelector('#login-email');

    const loginPassword =
        document.querySelector('#login-password');

    const loginError =
        document.querySelector('#login-error');

    const signOutButton =
        document.querySelector('#sign-out');

    const signInPanel =
        document.querySelector('#sign-in-panel');

    const forgotPasswordPanel =
        document.querySelector('#forgot-password-panel');

    const newPasswordPanel =
        document.querySelector('#new-password-panel');

    const forgotPasswordForm =
        document.querySelector('#forgot-password-form');

    const newPasswordForm =
        document.querySelector('#new-password-form');

    let recoveryMode =
        window.location.hash.includes('type=recovery');

    /*
     * Helpers
     */

    function renderRepairs() {
        if (window.GotCrackedUI?.filterRepairs) {
            window.GotCrackedUI.filterRepairs();
        } else if (window.GotCrackedUI?.renderRepairs) {
            window.GotCrackedUI.renderRepairs(window.GotCrackedRepairs);
        }
    }

    function showLoginError(message) {
        console.error(
            'LOGIN ERROR:',
            message
        );

        if (loginError) {
            loginError.textContent =
                message;

            loginError.style.display =
                'block';
        }
    }

    function clearLoginError() {
        if (loginError) {
            loginError.textContent = '';

            loginError.style.display =
                'none';
        }
    }

    function setMessage(element, message, isError = false) {
        if (!element) {
            return;
        }

        element.textContent = message;
        element.classList.toggle('error', isError);
    }

    function showAuthPanel(panel) {
        [signInPanel, forgotPasswordPanel, newPasswordPanel]
            .forEach(item => {
                if (!item) {
                    return;
                }

                const active = item === panel;
                item.classList.toggle('hidden', !active);
                item.setAttribute('aria-hidden', String(!active));
            });

        if (loginScreen) {
            loginScreen.classList.remove('hidden');
        }
    }

    function clearRecoveryUrl() {
        window.history.replaceState(
            {},
            document.title,
            window.location.pathname + window.location.search
        );
    }

    function showRecoveryPanel() {
        recoveryMode = true;
        showAuthPanel(newPasswordPanel);
        setMessage(
            document.querySelector('#new-password-message'),
            'Use the form below to set your new password.'
        );
        document.querySelector('#new-password')?.focus();
    }

    function setStaff(staff) {

        const nameElement =
            document.querySelector('#staff-name');

        const roleElement =
            document.querySelector('#staff-role');

        const initialsElement =
            document.querySelector('#staff-initials');

        if (nameElement) {
            nameElement.textContent =
                staff.name || 'Staff';
        }

        if (roleElement) {
            roleElement.textContent =
                staff.role || 'Staff';
        }

        if (initialsElement) {

            initialsElement.textContent =
                (staff.name || 'Staff')
                    .split(' ')
                    .filter(Boolean)
                    .map(part => part[0])
                    .join('')
                    .slice(0, 2)
                    .toUpperCase();
        }
    }

    /*
     * Load staff profile
     */

    async function loadProfile(userId) {

        console.log(
            'Loading staff profile:',
            userId
        );

        const {
            data: profile,
            error
        } = await window.supabaseClient
            .from('profiles')
            .select('*')
            .eq('id', userId)
            .single();

        if (error) {

            console.error(
                'PROFILE LOAD FAILED:',
                error
            );

            showLoginError(
                'Your account signed in, but your staff profile could not be loaded.'
            );

            return false;
        }

        if (!profile) {

            showLoginError(
                'Your account signed in, but no staff profile was found.'
            );

            return false;
        }

        if (!profile.active) {

            sessionStorage.removeItem('gotcracked-staff');
            sessionStorage.setItem(
                'gc-auth-error',
                'Your GotCracked staff access is inactive. Contact an owner or manager.'
            );

            await window.supabaseClient.auth.signOut();

            if (loginScreen) {
                loginScreen.classList.remove('hidden');
            }

            showLoginError(
                'Your GotCracked staff access is inactive. Contact an owner or manager.'
            );

            return false;
        }

        const staff = {
            id: userId,
            name:
                profile.display_name ||
                'Staff',
            role:
                profile.role ||
                'Staff'
        };

        sessionStorage.setItem(
            'gotcracked-staff',
            JSON.stringify(staff)
        );

        setStaff(staff);

        /* Legacy profiles used to redirect to a setup page that did not exist
         * on Cloudflare Pages, causing an infinite fallback/reload loop.
         * Discord onboarding now replaces that password-setup redirect. */
        window.GotCrackedNeedsDiscordLink =
            profile.role !== 'owner' && !profile.discord_user_id;

        if (loginScreen) {
            loginScreen.classList.add('hidden');
        }

        if (window.GotCrackedNeedsDiscordLink) {
            sessionStorage.setItem(
                'gc-onboarding-message',
                'Link your individual Discord account in Staff access before using shared shop data.'
            );
            document.dispatchEvent(new CustomEvent(
                'gc-onboarding-required',
                { detail: 'Link your individual Discord account in Staff access before using shared shop data.' }
            ));
            setTimeout(() => document.querySelector('[data-view="staff"]')?.click(), 0);
        }

        console.log(
            'STAFF PROFILE LOADED:',
            staff.name
        );

        return true;
    }

    /*
     * Load repairs.
     *
     * IMPORTANT:
     * This is NOT called until a valid authenticated
     * session exists.
     *
     * This prevents the previous:
     *
     * 42501 permission denied
     *
     * anonymous RLS error.
     */

    async function loadRepairs() {

        if (!window.supabaseClient) {

            console.error(
                'REPAIR LOAD FAILED: Supabase client unavailable.'
            );

            return;
        }

        console.log(
            'Loading repair tickets...'
        );

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
            .order(
                'ticket_number',
                {
                    ascending: false
                }
            );

        if (error) {

            console.error(
                'REPAIR LOAD FAILED:',
                error
            );

            return;
        }

        window.GotCrackedRepairs =
            (data || []).map(ticket => {

                const firstName =
                    ticket.customers?.first_name ||
                    '';

                const lastName =
                    ticket.customers?.last_name ||
                    '';

                const customerName =
                    `${firstName} ${lastName}`
                        .trim();

                return {

                    id:
                        ticket.ticket_number,

                    customer:
                        customerName ||
                        ticket.customer_id ||
                        'Unknown customer',

                    device:
                        ticket.devices?.model ||
                        ticket.device_id ||
                        'Unknown device',

                    service:
                        ticket.customer_issue ||
                        'No service listed',

                    tech:
                        ticket.profiles?.display_name ||
                        ticket.assigned_user_id ||
                        '—',

                    statusKey:
                        ticket.status ||
                        'awaiting_repair',

                    status:
                        repairStatusLabels[ticket.status] ||
                        ticket.status ||
                        'Awaiting Repair',

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

        console.log(
            'REPAIR TICKETS LOADED:',
            window.GotCrackedRepairs.length
        );

        renderRepairs();
    }

    /*
     * Authentication / session
     */

    async function loadSession() {

        await window.GotCrackedDiscordReady;

        if (!window.supabaseClient) {

            console.error(
                'AUTH FAILED: Supabase client unavailable.'
            );

            showLoginError(
                'The portal could not connect to authentication.'
            );

            return;
        }

        console.log(
            'AUTH STATE: INITIAL_SESSION'
        );

        if (recoveryMode) {
            showRecoveryPanel();
            return;
        }

        try {

            const {
                data,
                error
            } =
            await window.supabaseClient
                .auth.getSession();

            if (error) {

                console.error(
                    'SESSION LOAD FAILED:',
                    error
                );

                return;
            }

            const session =
                data?.session;

            if (!session) {

                console.log(
                    'NO ACTIVE SESSION'
                );

                /*
                 * DO NOT load repairs here.
                 *
                 * Anonymous users do not have
                 * permission to read repair_tickets.
                 */

                return;
            }

            console.log(
                'EXISTING SESSION:',
                session.user.email
            );

            const profileLoaded =
                await loadProfile(
                    session.user.id
                );

            if (profileLoaded) {
                await loadRepairs();
            }

        } catch (error) {

            console.error(
                'SESSION ERROR:',
                error
            );
        }
    }

    /*
     * Password recovery
     */

    document
        .querySelector('#forgot-password')
        ?.addEventListener('click', () => {
            clearLoginError();
            setMessage(
                document.querySelector('#forgot-password-message'),
                ''
            );
            showAuthPanel(forgotPasswordPanel);
            document.querySelector('#reset-email')?.focus();
        });

    document
        .querySelector('[data-show-sign-in]')
        ?.addEventListener('click', () => {
            showAuthPanel(signInPanel);
            loginEmail?.focus();
        });

    forgotPasswordForm?.addEventListener(
        'submit',
        async event => {
            event.preventDefault();

            const message =
                document.querySelector('#forgot-password-message');

            const email =
                document.querySelector('#reset-email')?.value?.trim();

            if (!email) {
                setMessage(message, 'Enter your work email.', true);
                return;
            }

            if (!window.supabaseClient) {
                setMessage(
                    message,
                    'The portal could not connect to authentication. Please refresh and try again.',
                    true
                );
                return;
            }

            const button =
                forgotPasswordForm.querySelector('button[type="submit"]');

            button.disabled = true;
            button.textContent = 'Sending…';
            setMessage(message, '');

            try {
                const { error } = await window.supabaseClient
                    .auth.resetPasswordForEmail(email, {
                        redirectTo:
                            window.location.origin +
                            window.location.pathname
                    });

                if (error) {
                    throw error;
                }

                setMessage(
                    message,
                    'If this email belongs to a staff account, a reset link has been sent.'
                );
            } catch (error) {
                console.error('PASSWORD RESET REQUEST FAILED:', error);
                setMessage(
                    message,
                    error?.message || 'Unable to send the reset link. Please try again.',
                    true
                );
            } finally {
                button.disabled = false;
                button.textContent = 'Send reset link';
            }
        }
    );

    newPasswordForm?.addEventListener(
        'submit',
        async event => {
            event.preventDefault();

            const message =
                document.querySelector('#new-password-message');

            const password =
                document.querySelector('#new-password')?.value || '';

            const confirmation =
                document.querySelector('#confirm-password')?.value || '';

            if (password.length < 8) {
                setMessage(message, 'Use a password with at least 8 characters.', true);
                return;
            }

            if (password !== confirmation) {
                setMessage(message, 'The passwords do not match.', true);
                return;
            }

            const button =
                newPasswordForm.querySelector('button[type="submit"]');

            button.disabled = true;
            button.textContent = 'Saving…';
            setMessage(message, '');

            try {
                const { error } = await window.supabaseClient
                    .auth.updateUser({ password });

                if (error) {
                    throw error;
                }

                await window.supabaseClient.auth.signOut();
                clearRecoveryUrl();
                recoveryMode = false;
                newPasswordForm.reset();
                showAuthPanel(signInPanel);
                setMessage(
                    document.querySelector('#login-error'),
                    'Password updated. Sign in with your new password.'
                );
                loginEmail?.focus();
            } catch (error) {
                console.error('PASSWORD UPDATE FAILED:', error);
                setMessage(
                    message,
                    error?.message || 'Unable to save the new password. Request another reset link and try again.',
                    true
                );
            } finally {
                button.disabled = false;
                button.textContent = 'Save new password';
            }
        }
    );

    window.supabaseClient?.auth.onAuthStateChange(
        event => {
            if (event === 'PASSWORD_RECOVERY') {
                showRecoveryPanel();
            }
        }
    );

    /*
     * Login
     */

    let loginInProgress = false;

    async function handleLogin(event) {

        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }

        if (loginInProgress) {
            return;
        }

        loginInProgress = true;

        console.log(
            'LOGIN SUBMIT FIRED'
        );

        clearLoginError();

        if (!window.supabaseClient) {

            showLoginError(
                'Authentication is not available. Please refresh the portal.'
            );

            loginInProgress = false;

            return;
        }

        const email =
            loginEmail?.value?.trim() || '';

        const password =
            loginPassword?.value || '';

        if (!email) {

            showLoginError(
                'Please enter your work email.'
            );

            loginEmail?.focus();

            loginInProgress = false;

            return;
        }

        if (!password) {

            showLoginError(
                'Please enter your password.'
            );

            loginPassword?.focus();

            loginInProgress = false;

            return;
        }

        const submitButton =
            loginForm?.querySelector(
                'button[type="submit"]'
            );

        if (submitButton) {

            submitButton.disabled = true;

            submitButton.textContent =
                'Signing in...';
        }

        console.log(
            'AUTH REQUEST:',
            email
        );

        try {

            const {
                data,
                error
            } =
            await window.supabaseClient
                .auth.signInWithPassword({
                    email,
                    password
                });

            console.log(
                'AUTH RESPONSE:',
                {
                    user:
                        data?.user?.id ||
                        null,

                    error:
                        error?.message ||
                        null
                }
            );

            if (error) {

                showLoginError(
                    error.message ||
                    'Unable to sign in.'
                );

                return;
            }

            if (!data?.user) {

                showLoginError(
                    'Sign-in completed without a user account.'
                );

                return;
            }

            console.log(
                'LOGIN SUCCESS:',
                data.user.email
            );

            const profileLoaded =
                await loadProfile(
                    data.user.id
                );

            if (!profileLoaded) {
                return;
            }

            await loadRepairs();

        } catch (error) {

            console.error(
                'LOGIN EXCEPTION:',
                error
            );

            showLoginError(
                error?.message ||
                'An unexpected error occurred while signing in.'
            );

        } finally {

            if (submitButton) {

                submitButton.disabled =
                    false;

                submitButton.textContent =
                    'Sign in to portal';
            }

            loginInProgress = false;
        }
    }

    /*
     * Login event wiring
     */

    if (loginForm) {

        console.log(
            'LOGIN FORM FOUND'
        );

        loginForm.addEventListener(
            'submit',
            handleLogin
        );

        /*
         * Fallback click handler.
         *
         * This guarantees the login button still
         * invokes authentication even if the HTML
         * button markup is not behaving as expected.
         */

        const loginButton =
            loginForm.querySelector(
                'button[type="submit"]'
            );

        if (loginButton) {

            loginButton.addEventListener(
                'click',
                event => {

                    event.preventDefault();

                    handleLogin(event);
                }
            );
        }

        console.log(
            'LOGIN HANDLER LOADED'
        );

    } else {

        console.error(
            'LOGIN FORM NOT FOUND: #login-form'
        );
    }

    /*
     * Sign out
     */

    if (signOutButton) {

        signOutButton.addEventListener(
            'click',
            async event => {

                event.preventDefault();

                try {

                    await window.supabaseClient
                        .auth.signOut();

                } catch (error) {

                    console.error(
                        'SIGN OUT FAILED:',
                        error
                    );
                }

                sessionStorage.removeItem(
                    'gotcracked-staff'
                );

                window.GotCrackedRepairs = [];

                if (loginScreen) {
                    loginScreen.classList.remove(
                        'hidden'
                    );
                }

                renderRepairs();
            }
        );
    }

    /*
     * Startup
     *
     * ONLY authentication starts here.
     *
     * loadRepairs() is intentionally NOT called
     * separately because anonymous users are blocked
     * by RLS.
     */

    loadSession();

})();
