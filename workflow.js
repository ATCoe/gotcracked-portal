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

    /*
     * Helpers
     */

    function renderRepairs() {
        if (window.GotCrackedUI?.renderRepairs) {
            window.GotCrackedUI.renderRepairs(
                window.GotCrackedRepairs
            );
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

        if (profile.must_change_password) {

            window.location.href =
                '/setup-password.html';

            return true;
        }

        if (loginScreen) {
            loginScreen.classList.add('hidden');
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
