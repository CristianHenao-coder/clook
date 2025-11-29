import { supabase } from './supabase.js';

document.getElementById('register-form').addEventListener('submit', async (event) => {
    event.preventDefault();

    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;

    const { user, error } = await supabase.auth.signUp({
        email: email,
        password: password
    });

    if (error) {
        alert(error.message);
    } else {
        alert('Registro exitoso!');
    }
});