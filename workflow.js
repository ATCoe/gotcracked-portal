// ============================================================
// GOTCRACKED PORTAL - AUTHENTICATION WORKFLOW
// ============================================================

console.log('LOGIN HANDLER LOADED');


// ============================================================
// STAFF UI
// ============================================================

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

        const initials =
            (staff.name || 'Staff')
                .split(' ')
                .filter(Boolean)
                .map(part => part[0])
                .join('')
                .slice(0, 2)
                .toUpperCase();


        initialsElement.textContent =
            initials;

    }

}


// ============================================================
// LOAD STAFF PROFILE
// ============================================================

async function loadProfile(userId) {

    if (!window.supabaseClient) {

        console.error(
            'Supabase client is not available.'
        );

        return false;

    }


    const {
        data: profile,
        error
    } =
        await window.supabaseClient
            .from('profiles')
            .select('*')
            .eq('id', userId)
            .single();


    if (error) {

        console.error(
            'Profile load failed:',
            error
        );

        const message =
            document.querySelector(
                '#login-error'
            );


        if (message) {

            message.textContent =
                'Your account was authenticated, but your staff profile could not be loaded.';

        }


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

        return false;

    }


    const loginScreen =
        document.querySelector(
            '#login-screen'
        );


    if (loginScreen) {

        loginScreen.classList.add(
            'hidden'
        );

    }


    // ========================================================
    // AUTHENTICATION IS NOW CONFIRMED.
    // Tell app.js to load live repair data.
    // ========================================================

    if (
        typeof window.loadRepairs ===
        'function'
    ) {

        await window.loadRepairs();

    }


    return true;

}


// ============================================================
// LOAD EXISTING SESSION
// ============================================================

async function loadSession() {

    if (!window.supabaseClient) {

        console.error(
            'Supabase client is not available.'
        );

        return;

    }


    try {

        const {
            data: {
                session
            }
        } =
            await window.supabaseClient
                .auth
                .getSession();


        if (!session) {

            return;

        }


        await loadProfile(
            session.user.id
        );

    }
    catch (error) {

        console.error(
            'Session load failed:',
            error
        );

    }

}


// ============================================================
// LOGIN FORM
//
// IMPORTANT:
// This is delegated to document rather than querying
// #login-form during script startup. That prevents the
// browser's native form submission from refreshing the page
// when workflow.js loads before the form exists.
// ============================================================

document.addEventListener(
    'submit',
    async event => {

        const form =
            event.target;


        if (
            !form ||
            form.id !== 'login-form'
        ) {

            return;

        }


        // STOP THE BROWSER FROM SUBMITTING
        // THE FORM AND REFRESHING THE PAGE.
        event.preventDefault();
        event.stopPropagation();


        const emailInput =
            document.querySelector(
                '#login-email'
            );


        const passwordInput =
            document.querySelector(
                '#login-password'
            );


        const message =
            document.querySelector(
                '#login-error'
            );


        const button =
            form.querySelector(
                'button[type="submit"]'
            );


        const email =
            emailInput?.value?.trim() ||
            '';


        const password =
            passwordInput?.value ||
            '';


        if (message) {

            message.textContent = '';

        }


        if (!email) {

            if (message) {

                message.textContent =
                    'Please enter your email address.';

            }


            emailInput?.focus();

            return;

        }


        if (!password) {

            if (message) {

                message.textContent =
                    'Please enter your password.';

            }


            passwordInput?.focus();

            return;

        }


        if (!window.supabaseClient) {

            if (message) {

                message.textContent =
                    'Authentication service is unavailable.';

            }


            console.error(
                'Supabase client is not available.'
            );

            return;

        }


        if (button) {

            button.disabled = true;

        }


        if (message) {

            message.textContent =
                'Signing in...';

        }


        try {

            console.log(
                'LOGIN SUBMIT HANDLER FIRED'
            );


            const {
                data,
                error
            } =
                await window.supabaseClient
                    .auth
                    .signInWithPassword({

                        email,

                        password

                    });


            if (error) {

                console.error(
                    'Login failed:',
                    error
                );


                if (message) {

                    message.textContent =
                        error.message ||
                        'Unable to sign in.';

                }


                return;

            }


            if (
                !data ||
                !data.user
            ) {

                if (message) {

                    message.textContent =
                        'Login succeeded, but no user session was returned.';

                }


                return;

            }


            console.log(
                'LOGIN SUCCESS:',
                data.user.email
            );


            if (message) {

                message.textContent =
                    '';

            }


            await loadProfile(
                data.user.id
            );

        }
        catch (error) {

            console.error(
                'Unexpected login error:',
                error
            );


            if (message) {

                message.textContent =
                    error?.message ||
                    'An unexpected error occurred while signing in.';

            }

        }
        finally {

            if (button) {

                button.disabled = false;

            }

        }

    },
    true
);


// ============================================================
// SIGN OUT
// ============================================================

document.addEventListener(
    'click',
    async event => {

        const button =
            event.target.closest(
                '#sign-out'
            );


        if (!button) {

            return;

        }


        event.preventDefault();


        if (!window.supabaseClient) {

            return;

        }


        try {

            await window.supabaseClient
                .auth
                .signOut();


            sessionStorage.removeItem(
                'gotcracked-staff'
            );


            window.repairs = [];


            if (
                typeof window.renderRepairs ===
                'function'
            ) {

                window.renderRepairs([]);

            }


            const loginScreen =
                document.querySelector(
                    '#login-screen'
                );


            if (loginScreen) {

                loginScreen.classList.remove(
                    'hidden'
                );

            }

        }
        catch (error) {

            console.error(
                'Sign out failed:',
                error
            );

        }

    },
    true
);


// ============================================================
// SUPABASE AUTH STATE
// ============================================================

if (window.supabaseClient) {

    window.supabaseClient.auth
        .onAuthStateChange(
            async (event, session) => {

                console.log(
                    'AUTH STATE:',
                    event
                );


                if (
                    event ===
                    'SIGNED_OUT'
                ) {

                    window.repairs = [];


                    if (
                        typeof window.renderRepairs ===
                        'function'
                    ) {

                        window.renderRepairs([]);

                    }


                    return;

                }


                if (
                    event ===
                    'SIGNED_IN' &&
                    session?.user
                ) {

                    await loadProfile(
                        session.user.id
                    );

                }

            }
        );

}


// ============================================================
// INITIAL SESSION CHECK
// ============================================================

if (
    document.readyState ===
    'loading'
) {

    document.addEventListener(
        'DOMContentLoaded',
        loadSession,
        {
            once: true
        }
    );

}
else {

    loadSession();

}
