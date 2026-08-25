(() => {
    'use strict';

    console.log('WORKFLOW.JS LOADED');

    const supabase = window.supabaseClient;

    if (!supabase) {
        console.error('SUPABASE CLIENT NOT FOUND');
        return;
    }

    const loginScreen = document.querySelector('#login-screen');
    const loginForms = document.querySelectorAll('#login-form');

    console.log('LOGIN FORMS FOUND:', loginForms.length);

    function getLoginErrorElement() {
        let element = document.querySelector('#login-error');

        if (!element && loginForms.length) {
            element = document.createElement('div');
            element.id = 'login-error';
            element.setAttribute('role', 'alert');

            element.style.marginTop = '12px';
            element.style.padding = '10px 12px';
            element.style.borderRadius = '8px';
            element.style.background = '#fee2e2';
            element.style.color = '#991b1b';
            element.style.fontSize = '14px';

            loginForms[0].appendChild(element);
        }

        return element;
    }

    function showLoginError(message) {
        const element = getLoginErrorElement();

        if (element) {
            element.textContent = message;
            element.style.display = 'block';
        }

        console.error('LOGIN ERROR:', message);
    }

    function clearLoginError() {
        const element = getLoginErrorElement();

        if (element) {
            element.textContent = '';
            element.style.display = 'none';
        }
    }

    function setStaff(staff) {
        const nameElement = document.querySelector('#staff-name');
        const roleElement = document.querySelector('#staff-role');
        const initialsElement = document.querySelector('#staff-initials');

        if (nameElement) {
            nameElement.textContent = staff.name || staff.email || 'Staff';
        }

        if (roleElement) {
            roleElement.textContent = staff.role || 'Staff';
        }

        if (initialsElement) {
            const source = staff.name || staff.email || 'GC';

            initialsElement.textContent = source
                .split(/\s+/)
                .map(part => part[0])
                .join('')
                .slice(0, 2)
                .toUpperCase();
        }
    }

    async function loadProfile(userId, email) {
        try {
            const {
                data: profile,
                error
            } = await supabase
                .from('profiles')
                .select('*')
                .eq('id', userId)
                .maybeSingle();

            if (error) {
                console.warn('PROFILE LOAD FAILED:', error);

                const fallbackStaff = {
                    id: userId,
                    name: email || 'Staff',
                    role: 'Staff',
                    email: email || ''
                };

                sessionStorage.setItem(
                    'gotcracked-staff',
                    JSON.stringify(fallbackStaff)
                );

                setStaff(fallbackStaff);

                return fallbackStaff;
            }

            const staff = {
                id: userId,
                name: profile?.display_name || email || 'Staff',
                role: profile?.role || 'Staff',
                email: email || ''
            };

            sessionStorage.setItem(
                'gotcracked-staff',
                JSON.stringify(staff)
            );

            setStaff(staff);

            if (profile?.must_change_password) {
                window.location.href = '/setup-password.html';
                return staff;
            }

            return staff;

        } catch (error) {
            console.error('PROFILE EXCEPTION:', error);

            const fallbackStaff = {
                id: userId,
                name: email || 'Staff',
                role: 'Staff',
                email: email || ''
            };

            sessionStorage.setItem(
                'gotcracked-staff',
                JSON.stringify(fallbackStaff)
            );

            setStaff(fallbackStaff);

            return fallbackStaff;
        }
    }

    async function handleLogin(event) {
        event.preventDefault();
        event.stopPropagation();

        console.log('LOGIN SUBMIT HANDLER FIRED');

        clearLoginError();

        const form = event.currentTarget;

        const emailInput = form.querySelector(
            '#login-email, [name="email"], input[type="email"]'
        );

        const passwordInput = form.querySelector(
            '#login-password, [name="password"], input[type="password"]'
        );

        if (!emailInput || !passwordInput) {
            showLoginError('Login form fields could not be found.');
            return false;
        }

        const email = emailInput.value.trim();
        const password = passwordInput.value;

        if (!email || !password) {
            showLoginError('Please enter your email and password.');
            return false;
        }

        const submitButton =
            form.querySelector('button[type="submit"], input[type="submit"]');

        if (submitButton) {
            submitButton.disabled = true;
            submitButton.dataset.originalText =
                submitButton.textContent || submitButton.value || '';

            if (submitButton.tagName === 'BUTTON') {
                submitButton.textContent = 'Signing in...';
            } else {
                submitButton.value = 'Signing in...';
            }
        }

        console.log('ATTEMPTING SUPABASE LOGIN:', email);

        try {
            const {
                data,
                error
            } = await supabase.auth.signInWithPassword({
                email,
                password
            });

            console.log('SUPABASE LOGIN RESULT:', {
                success: !error,
                userId: data?.user?.id || null,
                error: error?.message || null
            });

            if (error) {
                showLoginError(error.message || 'Unable to sign in.');
                return false;
            }

            if (!data?.user) {
                showLoginError('Login succeeded but no user session was returned.');
                return false;
            }

            console.log('LOGIN SUCCESS:', data.user.id);

            await loadProfile(
                data.user.id,
                data.user.email || email
            );

            if (loginScreen) {
                loginScreen.classList.add('hidden');
            }

            form.reset();

            console.log('LOGIN COMPLETE');

            return false;

        } catch (error) {
            console.error('LOGIN EXCEPTION:', error);

            showLoginError(
                error?.message ||
                'An unexpected error occurred while signing in.'
            );

            return false;

        } finally {
            if (submitButton) {
                submitButton.disabled = false;

                const originalText =
                    submitButton.dataset.originalText || 'Sign in';

                if (submitButton.tagName === 'BUTTON') {
                    submitButton.textContent = originalText;
                } else {
                    submitButton.value = originalText;
                }
            }
        }
    }

    loginForms.forEach(form => {
        form.addEventListener('submit', handleLogin, true);
    });

    console.log('LOGIN HANDLER LOADED');

    async function loadSession() {
        console.log('AUTH STATE: CHECKING SESSION');

        try {
            const {
                data,
                error
            } = await supabase.auth.getSession();

            if (error) {
                console.error('SESSION ERROR:', error);
                return;
            }

            const session = data?.session;

            if (!session) {
                console.log('NO ACTIVE SESSION');

                if (loginScreen) {
                    loginScreen.classList.remove('hidden');
                }

                return;
            }

            console.log(
                'ACTIVE SESSION:',
                session.user.email
            );

            await loadProfile(
                session.user.id,
                session.user.email
            );

            if (loginScreen) {
                loginScreen.classList.add('hidden');
            }

        } catch (error) {
            console.error('SESSION EXCEPTION:', error);
        }
    }

    supabase.auth.onAuthStateChange((event, session) => {
        console.log(
            'AUTH EVENT:',
            event,
            session?.user?.email || 'NO USER'
        );
    });

    const signOutButton = document.querySelector('#sign-out');

    if (signOutButton) {
        signOutButton.addEventListener('click', async event => {
            event.preventDefault();

            try {
                await supabase.auth.signOut();

                sessionStorage.removeItem('gotcracked-staff');

                if (loginScreen) {
                    loginScreen.classList.remove('hidden');
                }

                console.log('SIGNED OUT');

            } catch (error) {
                console.error('SIGN OUT ERROR:', error);
            }
        });
    }

    loadSession();

})();
