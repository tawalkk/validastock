const SUPABASE_URL = 'https://yyegkdtbkbtpwyrnbfhk.supabase.co';
const PUBLISHABLE_KEY = 'sb_publishable_xAVErX25ZXkD8B1SwFU41w_eeqBKyA0';
const LICENSE_FUNCTION = `${SUPABASE_URL}/functions/v1/pilotlocal-license`;
const SITE_URL = new URL('./', location.href).href;
const $ = (selector, root = document) => root.querySelector(selector);
const dialog = $('#authDialog');
let signupMode = false;
let session = null;
let recoveryToken = null;
let toastTimer = 0;

function setMessage(element, message = '', kind = '') {
  element.textContent = message;
  element.className = `form-message${kind ? ` ${kind}` : ''}`;
}

function toast(message) {
  const item = $('#toast');
  item.textContent = message;
  item.classList.add('show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => item.classList.remove('show'), 3600);
}

function openAuth(mode = 'login') {
  $('#authPanel').hidden = false;
  $('#resetPanel').hidden = true;
  $('#accountPanel').hidden = true;
  setMessage($('#authMessage'));
  signupMode = mode === 'signup';
  $('#authTitle').textContent = signupMode ? 'Crie sua conta' : 'Entre no Pilot Local';
  $('#authEyebrow').textContent = signupMode ? 'COMECE POR AQUI' : 'SUA CONTA';
  $('#authIntro').textContent = signupMode
    ? 'Cadastre seu e-mail e escolha uma senha para acessar o Pilot Local.'
    : 'Acesse sua conta para conferir e ativar sua licença.';
  $('#authSubmit').textContent = signupMode ? 'Criar conta' : 'Entrar';
  $('#authSwitch').textContent = signupMode ? 'Já tem conta? Entrar' : 'Ainda não tem conta? Criar conta';
  $('#authPassword').autocomplete = signupMode ? 'new-password' : 'current-password';
  if (!dialog.open) dialog.showModal();
}

async function authRequest(route, body, redirectTo) {
  const target = new URL(`${SUPABASE_URL}/auth/v1/${route}`);
  if (redirectTo) target.searchParams.set('redirect_to', redirectTo);
  const response = await fetch(target, {
    method: 'POST',
    headers: { apikey: PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.msg || data.message || data.error_description || data.error || 'Não foi possível concluir a solicitação.');
  return data;
}

async function licenseRequest(body) {
  const response = await fetch(LICENSE_FUNCTION, {
    method: 'POST',
    headers: {
      apikey: PUBLISHABLE_KEY,
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || data.message || `Falha ao consultar a licença (${response.status}).`);
  return data;
}

async function refreshSession() {
  if (!session?.refresh_token) throw new Error('Sua sessão expirou. Entre novamente.');
  const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: { apikey: PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: session.refresh_token }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error('Sua sessão expirou. Entre novamente.');
  session = data;
  sessionStorage.setItem('pilotlocal-session-v1', JSON.stringify(session));
}

async function withFreshSession(body) {
  try {
    return await licenseRequest(body);
  } catch (error) {
    if (!session || !/token|session|unauthorized/i.test(error.message)) throw error;
    await refreshSession();
    return await licenseRequest(body);
  }
}

function showAccount() {
  $('#authPanel').hidden = true;
  $('#resetPanel').hidden = true;
  $('#accountPanel').hidden = false;
  $('#accountTitle').textContent = 'Área da conta';
  $('#accountIntro').textContent = session?.user?.email || 'Conta autenticada';
  if (!dialog.open) dialog.showModal();
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(date);
}

async function loadCreatorLicenses() {
  const list = $('#licenseList');
  list.replaceChildren();
  try {
    const result = await withFreshSession({ action: 'list' });
    for (const license of result.licenses || []) {
      const row = document.createElement('div');
      row.className = 'license-row';
      const detail = document.createElement('span');
      const label = document.createElement('b');
      label.textContent = license.key_prefix;
      const expiry = document.createElement('small');
      expiry.textContent = license.revoked_at
        ? `Revogada em ${formatDate(license.revoked_at)}`
        : license.expires_at
          ? `Ativada · expira ${formatDate(license.expires_at)}`
          : `Ativar até ${formatDate(license.activation_expires_at)} · ${license.duration_days} dias`;
      detail.append(label, expiry);
      row.append(detail);
      if (!license.revoked_at) {
        const revoke = document.createElement('button');
        revoke.textContent = 'Revogar';
        revoke.addEventListener('click', async () => {
          revoke.disabled = true;
          try {
            await withFreshSession({ action: 'revoke', licenseId: license.id });
            toast('Chave revogada.');
            await loadCreatorLicenses();
          } catch (error) {
            revoke.disabled = false;
            toast(error.message);
          }
        });
        row.append(revoke);
      }
      list.append(row);
    }
    if (!(result.licenses || []).length) list.textContent = 'Nenhuma chave emitida ainda.';
  } catch (error) {
    list.textContent = error.message;
  }
}

async function enterAccount(data) {
  session = data;
  sessionStorage.setItem('pilotlocal-session-v1', JSON.stringify(session));
  showAccount();
  $('#customerPanel').hidden = true;
  $('#creatorPanel').hidden = true;
  try {
    const identity = await withFreshSession({ action: 'whoami' });
    if (identity.isCreator) {
      $('#accountTitle').textContent = 'Gerenciar licenças';
      $('#accountIntro').textContent = 'Gere chaves, acompanhe ativações e revogue acessos.';
      $('#creatorPanel').hidden = false;
      await loadCreatorLicenses();
      return;
    }
    const status = await withFreshSession({ action: 'status' });
    $('#customerPanel').hidden = false;
    if (status.active) {
      $('#licenseStatus').textContent = `Licença ativa até ${formatDate(status.expiresAt)}.`;
      $('#activateForm').hidden = true;
    } else {
      $('#licenseStatus').textContent = 'Sua conta ainda não tem licença ativa. Informe a chave recebida do criador.';
      $('#activateForm').hidden = false;
    }
  } catch (error) {
    $('#customerPanel').hidden = false;
    $('#licenseStatus').textContent = error.message;
  }
}

document.querySelectorAll('[data-open-auth]').forEach(button => {
  button.addEventListener('click', () => openAuth(button.dataset.openAuth));
});
$('#closeAuth').addEventListener('click', () => dialog.close());
$('#menuButton').addEventListener('click', () => $('.main-nav').classList.toggle('open'));
$('.main-nav').querySelectorAll('a').forEach(link => link.addEventListener('click', () => $('.main-nav').classList.remove('open')));

$('#authSwitch').addEventListener('click', () => openAuth(signupMode ? 'login' : 'signup'));
$('#forgotLink').addEventListener('click', async () => {
  const email = $('#authEmail').value.trim();
  setMessage($('#authMessage'));
  if (!email) {
    $('#authEmail').focus();
    return setMessage($('#authMessage'), 'Informe seu e-mail para receber o link.', 'error');
  }
  const button = $('#forgotLink');
  button.disabled = true;
  try {
    await authRequest('recover', { email }, SITE_URL);
    setMessage($('#authMessage'), 'Se essa conta existir, enviaremos o link para seu e-mail. Confira também o spam.', 'success');
  } catch (error) {
    setMessage($('#authMessage'), error.message, 'error');
  } finally {
    button.disabled = false;
  }
});

$('#authForm').addEventListener('submit', async event => {
  event.preventDefault();
  const button = $('#authSubmit');
  button.disabled = true;
  setMessage($('#authMessage'));
  try {
    const email = $('#authEmail').value.trim();
    const password = $('#authPassword').value;
    const data = signupMode
      ? await authRequest('signup', { email, password }, SITE_URL)
      : await authRequest('token?grant_type=password', { email, password });
    if (signupMode && !data.access_token) {
      setMessage($('#authMessage'), 'Conta criada. Confirme o e-mail enviado e depois entre aqui.', 'success');
      return;
    }
    await enterAccount(data);
  } catch (error) {
    setMessage($('#authMessage'), error.message, 'error');
  } finally {
    button.disabled = false;
  }
});

$('#resetForm').addEventListener('submit', async event => {
  event.preventDefault();
  const password = $('#newPassword').value;
  const confirmation = $('#confirmPassword').value;
  if (password.length < 8) return setMessage($('#resetMessage'), 'Use pelo menos 8 caracteres.', 'error');
  if (password !== confirmation) return setMessage($('#resetMessage'), 'As senhas não coincidem.', 'error');
  const button = event.submitter;
  button.disabled = true;
  try {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      method: 'PUT',
      headers: { apikey: PUBLISHABLE_KEY, Authorization: `Bearer ${recoveryToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.msg || data.message || 'O link expirou ou já foi usado. Solicite outro.');
    recoveryToken = null;
    history.replaceState(null, '', location.pathname + location.search);
    $('#resetForm').hidden = true;
    setMessage($('#resetMessage'), 'Senha redefinida. Volte ao Pilot Local e entre com a nova senha.', 'success');
  } catch (error) {
    setMessage($('#resetMessage'), error.message, 'error');
    button.disabled = false;
  }
});

$('#activateForm').addEventListener('submit', async event => {
  event.preventDefault();
  const key = $('#licenseKey').value.trim();
  try {
    const result = await withFreshSession({ action: 'activate', activationKey: key });
    $('#licenseStatus').textContent = `Licença ativa até ${formatDate(result.expiresAt)}.`;
    $('#activateForm').hidden = true;
  } catch (error) {
    $('#licenseStatus').textContent = error.message;
  }
});

$('#createKeys').addEventListener('click', async event => {
  const button = event.currentTarget;
  button.disabled = true;
  $('#issuedKeys').value = '';
  try {
    const result = await withFreshSession({
      action: 'create',
      count: Number($('#licenseCount').value),
      durationDays: Number($('#licenseDuration').value),
      activationDays: Number($('#licenseActivation').value),
    });
    $('#issuedKeys').value = result.licenses.map(item => `${item.key}  ·  ${item.durationDays} dias  ·  ativar até ${formatDate(item.activationExpiresAt)}`).join('\n');
    await loadCreatorLicenses();
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
  }
});
$('#refreshKeys').addEventListener('click', loadCreatorLicenses);
$('#signOut').addEventListener('click', () => {
  session = null;
  sessionStorage.removeItem('pilotlocal-session-v1');
  $('#accountPanel').hidden = true;
  $('#authPanel').hidden = false;
  setMessage($('#authMessage'), 'Você saiu da conta.', 'success');
});

$('#copyExample').addEventListener('click', async event => {
  const button = event.currentTarget;
  const code = 'wait 1200\nclick 420 260\ntext "Olá, Pilot Local"\nkey Enter\nlog "Rotina concluída"';
  try {
    await navigator.clipboard.writeText(code);
    button.textContent = 'Copiado ✓';
    window.setTimeout(() => { button.textContent = 'Copiar código'; }, 1700);
  } catch {
    toast('Não foi possível copiar. Selecione o exemplo e copie manualmente.');
  }
});

async function handleAuthRedirect() {
  const params = new URLSearchParams(location.hash.slice(1));
  const error = params.get('error_description') || params.get('error');
  const type = params.get('type');
  const token = params.get('access_token');
  if (error) {
    openAuth('login');
    setMessage($('#authMessage'), 'O link expirou ou já foi usado. Solicite um novo link nesta página.', 'error');
    history.replaceState(null, '', location.pathname + location.search);
    return;
  }
  if (type === 'recovery' && token) {
    recoveryToken = token;
    $('#authPanel').hidden = true;
    $('#accountPanel').hidden = true;
    $('#resetPanel').hidden = false;
    dialog.showModal();
    history.replaceState(null, '', location.pathname + location.search);
    return;
  }
  if (type === 'signup' && token) {
    openAuth('login');
    setMessage($('#authMessage'), 'E-mail confirmado. Entre para ativar sua licença.', 'success');
    history.replaceState(null, '', location.pathname + location.search);
  }
}

$('#createKeys').disabled = false;
void handleAuthRedirect();
