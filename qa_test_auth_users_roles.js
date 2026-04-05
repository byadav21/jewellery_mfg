const http = require('http');

function request(method, path, body, token) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const options = {
      hostname: 'localhost',
      port: 5000,
      path: '/api' + path,
      method,
      headers
    };
    if (data) headers['Content-Length'] = Buffer.byteLength(data);
    const req = http.request(options, (res) => {
      let raw = '';
      res.on('data', d => raw += d);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(raw); } catch(e) { json = raw; }
        resolve({ status: res.statusCode, body: json });
      });
    });
    req.on('error', e => resolve({ status: 0, error: e.message }));
    if (data) req.write(data);
    req.end();
  });
}

async function runAll() {
  const results = [];
  let token = null;
  let adminId = null;
  let newUserId = null;

  // ─── AUTH MODULE ───────────────────────────────────────────────────────────

  // TC-AUTH-01: Login with valid credentials
  let r = await request('POST', '/auth/login', { email: 'admin@jewellery.com', password: 'Admin@123' });
  token = (r.body && r.body.token) ? r.body.token
        : (r.body && r.body.data && r.body.data.token) ? r.body.data.token
        : null;
  adminId = (r.body && r.body.data && r.body.data.user)
            ? (r.body.data.user._id || r.body.data.user.id)
            : (r.body && r.body.user)
            ? (r.body.user._id || r.body.user.id)
            : null;
  results.push({
    id: 'TC-AUTH-01',
    desc: 'Login with valid credentials',
    expected: '200 + token',
    actual: r.status + (token ? ' + token' : ' NO TOKEN'),
    pass: r.status === 200 && !!token,
    notes: token ? ('token OK, adminId=' + adminId) : ('resp=' + JSON.stringify(r.body).substring(0, 100))
  });

  // TC-AUTH-02: Login with wrong password
  r = await request('POST', '/auth/login', { email: 'admin@jewellery.com', password: 'WrongPass!' });
  results.push({
    id: 'TC-AUTH-02',
    desc: 'Login with wrong password',
    expected: '401 or 400',
    actual: r.status,
    pass: r.status === 401 || r.status === 400,
    notes: JSON.stringify(r.body).substring(0, 100)
  });

  // TC-AUTH-03: Login with missing fields
  r = await request('POST', '/auth/login', { email: 'admin@jewellery.com' });
  results.push({
    id: 'TC-AUTH-03',
    desc: 'Login with missing password field',
    expected: '400',
    actual: r.status,
    pass: r.status === 400,
    notes: JSON.stringify(r.body).substring(0, 100)
  });

  // TC-AUTH-04: Access protected route without token
  r = await request('GET', '/auth/me', null, null);
  results.push({
    id: 'TC-AUTH-04',
    desc: 'Protected route without token',
    expected: '401',
    actual: r.status,
    pass: r.status === 401,
    notes: JSON.stringify(r.body).substring(0, 80)
  });

  // TC-AUTH-05: Access protected route with invalid token
  r = await request('GET', '/auth/me', null, 'invalid.jwt.token');
  results.push({
    id: 'TC-AUTH-05',
    desc: 'Protected route with invalid token',
    expected: '401',
    actual: r.status,
    pass: r.status === 401,
    notes: JSON.stringify(r.body).substring(0, 80)
  });

  // TC-AUTH-06: Get current user profile with valid token
  r = await request('GET', '/auth/me', null, token);
  const meUser = (r.body && r.body.data) ? r.body.data : r.body;
  results.push({
    id: 'TC-AUTH-06',
    desc: 'GET /api/auth/me with valid token',
    expected: '200',
    actual: r.status,
    pass: r.status === 200,
    notes: (meUser && meUser.email) ? ('email=' + meUser.email) : JSON.stringify(r.body).substring(0, 80)
  });

  // ─── USERS MODULE ──────────────────────────────────────────────────────────

  // TC-USR-01: Get all users
  r = await request('GET', '/users', null, token);
  const usersRaw = (r.body && r.body.data) ? r.body.data : (Array.isArray(r.body) ? r.body : null);
  const users = Array.isArray(usersRaw) ? usersRaw : (usersRaw && Array.isArray(usersRaw.users) ? usersRaw.users : null);
  results.push({
    id: 'TC-USR-01',
    desc: 'GET /api/users - get all users',
    expected: '200 + array',
    actual: r.status + (Array.isArray(users) ? (' + array[' + users.length + ']') : ''),
    pass: r.status === 200 && Array.isArray(users),
    notes: Array.isArray(users) ? (users.length + ' users found') : JSON.stringify(r.body).substring(0, 100)
  });

  // Derive adminId from users list if login didn't give it
  if (!adminId && Array.isArray(users)) {
    const adm = users.find(u => u.email === 'admin@jewellery.com');
    if (adm) adminId = adm._id || adm.id;
  }

  // TC-USR-02: Get user by ID
  if (adminId) {
    r = await request('GET', '/users/' + adminId, null, token);
    const u = (r.body && r.body.data) ? r.body.data : r.body;
    results.push({
      id: 'TC-USR-02',
      desc: 'GET /api/users/:id - get user by ID',
      expected: '200',
      actual: r.status,
      pass: r.status === 200,
      notes: (u && u.email) ? ('email=' + u.email) : JSON.stringify(r.body).substring(0, 80)
    });
  } else {
    results.push({
      id: 'TC-USR-02',
      desc: 'GET /api/users/:id - get user by ID',
      expected: '200',
      actual: 'SKIPPED',
      pass: false,
      notes: 'adminId could not be determined'
    });
  }

  // TC-USR-03: Create new user
  const testEmail = 'qatest_' + Date.now() + '@jewellery.com';
  const newUserPayload = {
    name: 'Test QA User',
    email: testEmail,
    password: 'QATest@123',
    role: 'designer'
  };
  r = await request('POST', '/users', newUserPayload, token);
  newUserId = (r.body && r.body.data && r.body.data._id) ? r.body.data._id
            : (r.body && r.body.data && r.body.data.id) ? r.body.data.id
            : (r.body && r.body._id) ? r.body._id
            : null;
  results.push({
    id: 'TC-USR-03',
    desc: 'POST /api/users - create new user with role',
    expected: '201',
    actual: r.status,
    pass: r.status === 201,
    notes: newUserId ? ('created _id=' + newUserId) : JSON.stringify(r.body).substring(0, 100)
  });

  // TC-USR-04: Create user with duplicate email
  r = await request('POST', '/users', newUserPayload, token);
  results.push({
    id: 'TC-USR-04',
    desc: 'Create user with duplicate email',
    expected: '400 or 409',
    actual: r.status,
    pass: r.status === 400 || r.status === 409,
    notes: JSON.stringify(r.body).substring(0, 100)
  });

  // TC-USR-05: Update user
  if (newUserId) {
    r = await request('PUT', '/users/' + newUserId, { name: 'QA Updated Name' }, token);
    const updated = (r.body && r.body.data) ? r.body.data : r.body;
    results.push({
      id: 'TC-USR-05',
      desc: 'PUT /api/users/:id - update user',
      expected: '200',
      actual: r.status,
      pass: r.status === 200,
      notes: (updated && updated.name) ? ('name=' + updated.name) : JSON.stringify(r.body).substring(0, 80)
    });
  } else {
    results.push({
      id: 'TC-USR-05',
      desc: 'PUT /api/users/:id - update user',
      expected: '200',
      actual: 'SKIPPED',
      pass: false,
      notes: 'newUserId not available'
    });
  }

  // TC-USR-06: Toggle active status
  if (newUserId) {
    r = await request('PATCH', '/users/' + newUserId + '/toggle-active', null, token);
    results.push({
      id: 'TC-USR-06',
      desc: 'PATCH /api/users/:id/toggle-active',
      expected: '200',
      actual: r.status,
      pass: r.status === 200,
      notes: JSON.stringify(r.body).substring(0, 100)
    });
  } else {
    results.push({
      id: 'TC-USR-06',
      desc: 'PATCH /api/users/:id/toggle-active',
      expected: '200',
      actual: 'SKIPPED',
      pass: false,
      notes: 'newUserId not available'
    });
  }

  // TC-USR-07: Get users by role
  r = await request('GET', '/users/by-role/designer', null, token);
  const byRoleRaw = (r.body && r.body.data) ? r.body.data : (Array.isArray(r.body) ? r.body : null);
  const byRole = Array.isArray(byRoleRaw) ? byRoleRaw : null;
  results.push({
    id: 'TC-USR-07',
    desc: 'GET /api/users/by-role/designer',
    expected: '200 + array',
    actual: r.status + (Array.isArray(byRole) ? (' array[' + byRole.length + ']') : ''),
    pass: r.status === 200,
    notes: Array.isArray(byRole) ? (byRole.length + ' designers') : JSON.stringify(r.body).substring(0, 100)
  });

  // ─── ROLES MODULE ──────────────────────────────────────────────────────────

  // TC-ROLE-01: Get all roles
  r = await request('GET', '/roles', null, token);
  const rolesRaw = (r.body && r.body.data) ? r.body.data : (Array.isArray(r.body) ? r.body : null);
  const roles = Array.isArray(rolesRaw) ? rolesRaw : null;
  const expectedRoleNames = ['super_admin', 'admin', 'designer', 'manufacturer'];
  const bodyStr = JSON.stringify(r.body);
  const hasAllRoles = expectedRoleNames.every(rn => bodyStr.includes(rn));
  const foundNames = roles ? roles.map(ro => ro.name || ro.slug || ro.code || ro.role || '?').join(', ') : 'n/a';
  results.push({
    id: 'TC-ROLE-01',
    desc: 'GET /api/roles - get all roles',
    expected: '200 + [super_admin, admin, designer, manufacturer]',
    actual: r.status + (roles ? (' [' + roles.length + ' roles]') : ''),
    pass: r.status === 200 && Array.isArray(roles) && hasAllRoles,
    notes: 'found: ' + foundNames + ' | allExpected=' + hasAllRoles
  });

  // TC-ROLE-02: Each role has permissions array
  let allHavePerms = false;
  let permNotes = '';
  if (Array.isArray(roles) && roles.length > 0) {
    allHavePerms = roles.every(ro => Array.isArray(ro.permissions));
    permNotes = roles.map(ro =>
      (ro.name || ro.slug || '?') + ':' + (Array.isArray(ro.permissions) ? ro.permissions.length + ' perms' : 'NO permissions[]')
    ).join(' | ');
  } else {
    permNotes = 'No roles array. body=' + JSON.stringify(r.body).substring(0, 100);
  }
  results.push({
    id: 'TC-ROLE-02',
    desc: 'Verify each role has permissions array',
    expected: 'All roles have permissions[]',
    actual: allHavePerms ? 'All have permissions[]' : 'Some missing permissions[]',
    pass: allHavePerms,
    notes: permNotes.substring(0, 200)
  });

  // ─── OUTPUT ────────────────────────────────────────────────────────────────
  console.log(JSON.stringify(results, null, 2));
}

runAll().catch(e => console.error(e.stack));
