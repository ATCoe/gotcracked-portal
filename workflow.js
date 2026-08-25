// GotCracked Portal Authentication Workflow

const loginScreen = document.querySelector('#login-screen');


function setStaff(staff) {

    const name = document.querySelector('#staff-name');
    const role = document.querySelector('#staff-role');
    const initials = document.querySelector('#staff-initials');


    if (name) {
        name.textContent = staff.name;
    }


    if (role) {
        role.textContent = staff.role;
    }


    if (initials) {

        initials.textContent = staff.name
            .split(' ')
            .map(part => part[0])
            .join('')
            .slice(0, 2)
            .toUpperCase();

    }

}


async function loadSession() {

    if (!window.supabaseClient) {

        console.error(
            'Supabase client missing'
        );

        return;

    }


    const {
        data: {
            session
        }
    } = await window.supabaseClient.auth.getSession();


    if (!session) {
        return;
    }


    await loadProfile(session.user.id);

}


async function loadProfile(userId) {

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
            'Profile load failed:',
            error
        );

        return;

    }


    const staff = {

        id: userId,

        name:
            profile.display_name ||
            'Staff',

        role:
            profile.role ||
            'Technician'

    };


    sessionStorage.setItem(
        'gotcracked-staff',
        JSON.stringify(staff)
    );


    setStaff(staff);


    if (profile.must_change_password) {

        window.location.href =
            '/setup-password.html';

        return;

    }


    loginScreen?.classList.add(
        'hidden'
    );


    // Tell the repair application that
    // authentication is confirmed.
    if (
        typeof window.loadRepairs ===
        'function'
    ) {

        await window.loadRepairs();

    }

}


console.log(
    'LOGIN HANDLER LOADED'
);


document
    .querySelector('#login-form')
    ?.addEventListener(
        'submit',
        async event => {

            event.preventDefault();


            const email =
                document.querySelector(
                    '#login-email'
                )?.value?.trim();


            const password =
                document.querySelector(
                    '#login-password'
                )?.value;


            const message =
                document.querySelector(
                    '#login-error'
                );


            if (message) {
                message.textContent = '';
            }


            if (!email || !password) {

                if (message) {
                    message.textContent =
                        'Please enter your email and password.';
                }

                return;

            }


            const {
                data,
                error
            } =
                await window.supabaseClient.auth
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
                        error.message;

                }

                return;

            }


            await loadProfile(
                data.user.id
            );

        }
    );


document
    .querySelector('#sign-out')
    ?.addEventListener(
        'click',
        async () => {

            await window.supabaseClient.auth.signOut();


            sessionStorage.removeItem(
                'gotcracked-staff'
            );


            if (
                Array.isArray(
                    window.repairs
                )
            ) {

                window.repairs = [];

            }


            if (
                typeof window.renderRepairs ===
                'function'
            ) {

                window.renderRepairs([]);

            }


            loginScreen?.classList.remove(
                'hidden'
            );

        }
    );


loadSession();
