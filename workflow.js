// ============================================================
// GOTCRACKED PORTAL
// AUTHENTICATION WORKFLOW
// ============================================================

console.log('LOGIN HANDLER LOADED');


// ============================================================
// STATE
// ============================================================

let loginInProgress = false;


// ============================================================
// HELPERS
// ============================================================

function getLoginElements() {

    return {

        form:
            document.querySelector(
                '#login-form'
            ),

        email:
            document.querySelector(
                '#login-email'
            ),

        password:
            document.querySelector(
                '#login-password'
            ),

        error:
            document.querySelector(
                '#login-error'
            ),

        button:
            document.querySelector(
                '#login-form button[type="submit"]'
            ) ||
            document.querySelector(
                '#login-form button'
            )

    };

}


function showLoginMessage(message) {

    const element =
        document.querySelector(
            '#login-error'
        );


    if (element) {

        element.textContent =
            message || '';

    }
    else if (message) {

        console.error(
            'LOGIN:',
            message
        );

    }

}


function setLoginBusy(busy) {

    const elements =
        getLoginElements();


    if (elements.button) {

        elements.button.disabled =
            busy;

    }


    if (busy) {

        showLoginMessage(
            'Signing in...'
        );

    }

}


// ============================================================
// STAFF UI
// ============================================================

function setStaff(staff) {

    const name =
        document.querySelector(
            '#staff-name'
        );


    const role =
        document.querySelector(
            '#staff-role'
        );


    const initials =
        document.querySelector(
            '#staff-initials'
        );


    if (name) {

        name.textContent =
            staff.name ||
            'Staff';

    }


    if (role) {

        role.textContent =
            staff.role ||
            'Staff';

    }


    if (initials) {

        initials.textContent =
            (staff.name || 'Staff')
                .split(' ')
                .filter(Boolean)
                .map(
                    part => part[0]
                )
                .join('')
                .slice(0, 2)
                .toUpperCase();

    }

}


// ============================================================
// LOAD PROFILE
// ============================================================

async function loadProfile(userId) {

    console.log(
        'Loading staff profile:',
        userId
    );


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


        showLoginMessage(
            'Login succeeded, but your staff profile could not be loaded.'
        );


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


    console.log(
        'STAFF AUTHENTICATED'
    );


    // ========================================================
    // NOW LOAD LIVE REPAIR DATA
    // ========================================================

    if (
        typeof window.loadRepairs ===
        'function'
    ) {

        console.log(
            'Loading repairs after authentication...'
        );


        await window.loadRepairs();

    }
    else {

        console.error(
            'window.loadRepairs is not available.'
        );

    }


    return true;

}


// ============================================================
// LOGIN
// ============================================================

async function performLogin() {

    if (loginInProgress) {

        return;

    }


    loginInProgress = true;


    const elements =
        getLoginElements();


    const email =
        elements.email?.value
            ?.trim() ||
        '';


    const password =
        elements.password?.value ||
        '';


    showLoginMessage('');


    if (!email) {

        showLoginMessage(
            'Please enter your email address.'
        );


        elements.email?.focus();


        loginInProgress = false;


        return;

    }


    if (!password) {

        showLoginMessage(
            'Please enter your password.'
        );


        elements.password?.focus();


        loginInProgress = false;


        return;

    }


    if (!window.supabaseClient) {

        showLoginMessage(
            'Authentication service is unavailable.'
        );


        console.error(
            'window.supabaseClient is missing.'
        );


        loginInProgress = false;


        return;

    }


    setLoginBusy(true);


    console.log(
        'LOGIN REQUEST STARTING'
    );


    try {

        const {
            data,
            error
        } =
            await window.supabaseClient
                .auth
                .signInWithPassword({

                    email:
                        email,

                    password:
                        password

                });


        if (error) {

            console.error(
                'LOGIN FAILED:',
                error
            );


            showLoginMessage(
                error.message ||
                'Unable to sign in.'
            );


            return;

        }


        if (
            !data ||
            !data.user
        ) {

            console.error(
                'Login returned no user:',
                data
            );


            showLoginMessage(
                'Login completed, but no user session was returned.'
            );


            return;

        }


        console.log(
            'LOGIN SUCCESS:',
            data.user.email
        );


        showLoginMessage('');


        await loadProfile(
            data.user.id
        );

    }
    catch (error) {

        console.error(
            'UNEXPECTED LOGIN ERROR:',
            error
        );


        showLoginMessage(
            error?.message ||
            'An unexpected error occurred while signing in.'
        );

    }
    finally {

        loginInProgress = false;


        const button =
            getLoginElements().button;


        if (button) {

            button.disabled =
                false;

        }

    }

}


// ============================================================
// DIRECT LOGIN BUTTON HANDLER
//
// This is the important part.
// We catch the actual button click rather than relying
// exclusively on the form's submit event.
// ============================================================

document.addEventListener(
    'click',
    event => {

        const button =
            event.target.closest(
                '#login-form button'
            );


        if (!button) {

            return;

        }


        console.log(
            'LOGIN BUTTON CLICKED'
        );


        event.preventDefault();
        event.stopPropagation();


        performLogin();

    },
    true
);


// ============================================================
// FORM SUBMIT FALLBACK
// ============================================================

document.addEventListener(
    'submit',
    event => {

        const form =
            event.target;


        if (
            !form ||
            form.id !== 'login-form'
        ) {

            return;

        }


        console.log(
            'LOGIN FORM SUBMITTED'
        );


        event.preventDefault();
        event.stopPropagation();


        performLogin();

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
                'SIGN OUT FAILED:',
                error
            );

        }

    },
    true
);


// ============================================================
// AUTH STATE
// ============================================================

if (window.supabaseClient) {

    window.supabaseClient.auth
        .onAuthStateChange(
            async (
                event,
                session
            ) => {

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


                // Don't independently load the profile here
                // for SIGNED_IN. performLogin() already does it.
                // This avoids duplicate profile/repair requests.

            }
        );

}


// ============================================================
// EXISTING SESSION
// ============================================================

async function loadSession() {

    if (!window.supabaseClient) {

        console.error(
            'Supabase client is unavailable.'
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


        console.log(
            'AUTH STATE: INITIAL_SESSION'
        );


        if (!session) {

            return;

        }


        await loadProfile(
            session.user.id
        );

    }
    catch (error) {

        console.error(
            'INITIAL SESSION FAILED:',
            error
        );

    }

}


// ============================================================
// START
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
