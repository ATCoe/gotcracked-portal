(() => {
    'use strict';

    console.log('WORKFLOW.JS LOADED');

    /*
     * ============================================================
     * GOTCRACKED REPAIR DATA
     * ============================================================
     */

    window.GotCrackedRepairs = [];

    /*
     * Compatibility alias for older portal code.
     *
     * portal-complete.js references "repairs".
     */

    try {
        Object.defineProperty(
            window,
            'repairs',
            {
                configurable: true,
                get() {
                    return window.GotCrackedRepairs;
                }
            }
        );
    } catch (error) {
        console.warn(
            'Could not create repairs compatibility alias.',
            error
        );
    }

    /*
     * ============================================================
     * LOGIN ELEMENTS
     * ============================================================
     *
     * The current index.html accidentally contains TWO login
     * screens/forms.
     *
     * Therefore we intentionally use querySelectorAll() and wire
     * EVERY login form instead of assuming there is only one.
     */

    const loginScreens =
        document.querySelectorAll(
            '#login-screen'
        );

    const loginForms =
        document.querySelectorAll(
            '#login-form'
        );

    const signOutButton =
        document.querySelector('#sign-out');

    console.log(
        'LOGIN FORMS FOUND:',
        loginForms.length
    );

    /*
     * ============================================================
     * LOGIN HELPERS
     * ============================================================
     */

    function getLoginError(form) {

        let error =
            form.querySelector(
                '#login-error'
            );

        /*
         * The newer visible login form currently does not
         * contain #login-error, so create one automatically.
         */

        if (!error) {

            error =
                document.createElement('p');

            error.id =
                'login-error';

            error.className =
                'error-message';

            error.setAttribute(
                'role',
                'alert'
            );

            form.appendChild(error);
        }

        return error;
    }

    function showLoginError(
        form,
        message
    ) {

        console.error(
            'LOGIN ERROR:',
            message
        );

        const error =
            getLoginError(form);

        error.textContent =
            message;

        error.style.display =
            'block';
    }

    function clearLoginError(form) {

        const error =
            getLoginError(form);

        error.textContent =
            '';

        error.style.display =
            'none';
    }

    function hideLoginScreens() {

        loginScreens.forEach(
            screen => {
                screen.classList.add(
                    'hidden'
                );
            }
        );
    }

    function showLoginScreens() {

        loginScreens.forEach(
            screen => {
                screen.classList.remove(
                    'hidden'
                );
            }
        );
    }

    /*
     * ============================================================
     * STAFF PROFILE
     * ============================================================
     */

    function setStaff(staff) {

        const nameElement =
            document.querySelector(
                '#staff-name'
            );

        const roleElement =
            document.querySelector(
                '#staff-role'
            );

        const initialsElement =
            document.querySelector(
                '#staff-initials'
            );

        if (nameElement) {

            nameElement.textContent =
                staff.name ||
                'Staff';
        }

        if (roleElement) {

            roleElement.textContent =
                staff.role ||
                'Staff';
        }

        if (initialsElement) {

            initialsElement.textContent =
                (staff.name || 'Staff')
                    .split(' ')
                    .filter(Boolean)
                    .map(
                        part =>
                            part[0]
                    )
                    .join('')
                    .slice(0, 2)
                    .toUpperCase();
        }
    }

    async function loadProfile(
        userId
    ) {

        console.log(
            'LOADING STAFF PROFILE:',
            userId
        );

        const {
            data: profile,
            error
        } =
            await window.supabaseClient
                .from('profiles')
                .select(
                    'id, display_name, role, active, must_change_password'
                )
                .eq(
                    'id',
                    userId
                )
                .single();

        if (error) {

            console.error(
                'PROFILE LOAD FAILED:',
                error
            );

            /*
             * This means authentication succeeded,
             * but the staff profile is missing or
             * inaccessible.
             */

            showLoginErrorForAllForms(
                'Your account signed in, but your GotCracked staff profile could not be loaded.'
            );

            return false;
        }

        if (!profile) {

            showLoginErrorForAllForms(
                'Your account signed in, but no staff profile was found.'
            );

            return false;
        }

        if (profile.active === false) {

            showLoginErrorForAllForms(
                'Your GotCracked staff account is inactive.'
            );

            await window.supabaseClient
                .auth.signOut();

            return false;
        }

        const staff = {

            id:
                userId,

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

        if (
            profile.must_change_password
        ) {

            window.location.href =
                '/setup-password.html';

            return true;
        }

        hideLoginScreens();

        console.log(
            'STAFF PROFILE LOADED:',
            staff.name
        );

        return true;
    }

    /*
     * ============================================================
     * LOGIN ERROR FOR ALL FORMS
     * ============================================================
     */

    function showLoginErrorForAllForms(
        message
    ) {

        loginForms.forEach(
            form => {
                showLoginError(
                    form,
                    message
                );
            }
        );
    }

    /*
     * ============================================================
     * REPAIR LOADING
     * ============================================================
     *
     * Repairs are ONLY loaded after authentication.
     */

    async function loadRepairs() {

        if (
            !window.supabaseClient
        ) {

            console.error(
                'REPAIR LOAD FAILED: Supabase client unavailable.'
            );

            return;
        }

        console.log(
            'LOADING REPAIR TICKETS...'
        );

        const {
            data,
            error
        } =
            await window.supabaseClient
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
            (data || []).map(
                ticket => {

                    const firstName =
                        ticket
                            .customers
                            ?.first_name ||
                        '';

                    const lastName =
                        ticket
                            .customers
                            ?.last_name ||
                        '';

                    const customerName =
                        `${firstName} ${lastName}`
                            .trim();

                    return {

                        id:
                            ticket.ticket_number,

                        customer:
                            customerName ||
                            'Unknown customer',

                        device:
                            ticket
                                .devices
                                ?.model ||
                            'Unknown device',

                        service:
                            ticket.customer_issue ||
                            'No service listed',

                        tech:
                            ticket
                                .profiles
                                ?.display_name ||
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
                }
            );

        console.log(
            'REPAIR TICKETS LOADED:',
            window.GotCrackedRepairs.length
        );

        renderRepairs();

        /*
         * Refresh portal-complete reports if that module
         * has already rendered them.
         */

        if (
            typeof window.pcRenderReports ===
            'function'
        ) {
            try {
                window.pcRenderReports();
            } catch (error) {
                console.warn(
                    'REPORT REFRESH FAILED:',
                    error
                );
            }
        }
    }

    /*
     * ============================================================
     * APP UI BRIDGE
     * ============================================================
     */

    function renderRepairs() {

        if (
            window.GotCrackedUI &&
            typeof window.GotCrackedUI
                .renderRepairs ===
                'function'
        ) {

            window.GotCrackedUI
                .renderRepairs(
                    window.GotCrackedRepairs
                );
        }
    }

    /*
     * ============================================================
     * SESSION
     * ============================================================
     */

    async function loadSession() {

        if (
            !window.supabaseClient
        ) {

            console.error(
                'AUTH FAILED: Supabase client unavailable.'
            );

            showLoginErrorForAllForms(
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

                showLoginScreens();

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
     * ============================================================
     * LOGIN
     * ============================================================
     */

    const loginInProgress =
        new WeakMap();

    async function handleLogin(
        event,
        form
    ) {

        event.preventDefault();
        event.stopPropagation();

        if (
            loginInProgress.get(form)
        ) {
            return;
        }

        loginInProgress.set(
            form,
            true
        );

        console.log(
            'LOGIN SUBMIT FIRED'
        );

        clearLoginError(form);

        if (
            !window.supabaseClient
        ) {

            showLoginError(
                form,
                'Authentication is not available. Please refresh the portal.'
            );

            loginInProgress.set(
                form,
                false
            );

            return;
        }

        const emailInput =
            form.querySelector(
                '#login-email'
            );

        const passwordInput =
            form.querySelector(
                '#login-password'
            );

        const email =
            emailInput?.value
                ?.trim() ||
            '';

        const password =
            passwordInput?.value ||
            '';

        if (!email) {

            showLoginError(
                form,
                'Please enter your work email.'
            );

            emailInput?.focus();

            loginInProgress.set(
                form,
                false
            );

            return;
        }

        if (!password) {

            showLoginError(
                form,
                'Please enter your password.'
            );

            passwordInput?.focus();

            loginInProgress.set(
                form,
                false
            );

            return;
        }

        const submitButton =
            form.querySelector(
                'button[type="submit"]'
            );

        if (submitButton) {

            submitButton.disabled =
                true;

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
                    form,
                    error.message ||
                    'Unable to sign in.'
                );

                return;
            }

            if (!data?.user) {

                showLoginError(
                    form,
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
                form,
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

            loginInProgress.set(
                form,
                false
            );
        }
    }

    /*
     * ============================================================
     * LOGIN FORM WIRING
     * ============================================================
     *
     * IMPORTANT:
     * There are currently two login forms in index.html.
     * Wire both so either one works.
     */

    loginForms.forEach(
        form => {

            console.log(
                'LOGIN FORM FOUND:',
                form
            );

            getLoginError(form);

            form.addEventListener(
                'submit',
                event => {
                    handleLogin(
                        event,
                        form
                    );
                }
            );

            const button =
                form.querySelector(
                    'button[type="submit"]'
                );

            if (button) {

                button.addEventListener(
                    'click',
                    event => {

                        /*
                         * Prevent the browser from performing
                         * the native form submission.
                         */

                        event.preventDefault();

                        handleLogin(
                            event,
                            form
                        );
                    }
                );
            }
        }
    );

    if (
        loginForms.length === 0
    ) {

        console.error(
            'LOGIN FORM NOT FOUND: #login-form'
        );

    } else {

        console.log(
            'LOGIN HANDLER LOADED'
        );
    }

    /*
     * ============================================================
     * SIGN OUT
     * ============================================================
     */

    if (signOutButton) {

        signOutButton.addEventListener(
            'click',
            async event => {

                event.preventDefault();

                try {

                    await window
                        .supabaseClient
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

                window.GotCrackedRepairs =
                    [];

                showLoginScreens();

                renderRepairs();

            }
        );
    }

    /*
     * ============================================================
     * STARTUP
     * ============================================================
     */

    loadSession();

})();
