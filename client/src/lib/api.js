const TOKEN_KEY = 'wp_token';

export class ApiError extends Error {
  constructor(status, code, message, details = undefined) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function getStoredToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token) {
  try {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
  } catch {
    // Ignore storage errors
  }
}

export async function apiRequest(path, { method = 'GET', body, token } = {}) {
  const authToken = token ?? getStoredToken();
  const headers = {};
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const contentType = res.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await res.json() : null;

  if (!res.ok) {
    const err = data?.error ?? {};
    throw new ApiError(
      res.status,
      err.code || 'HTTP_ERROR',
      err.message || `Помилка запиту (${res.status})`,
      err.details
    );
  }

  return data;
}

function buildQueryString(params = {}) {
  const search = new URLSearchParams();
  for (const [key, val] of Object.entries(params)) {
    if (val !== undefined && val !== null && val !== '') {
      search.set(key, String(val));
    }
  }
  const str = search.toString();
  return str ? `?${str}` : '';
}

export const authApi = {
  login: (credentials) => apiRequest('/auth/login', { method: 'POST', body: credentials }),
  me: () => apiRequest('/auth/me'),
};

export const ordersApi = {
  list: (filters) => apiRequest(`/orders${buildQueryString(filters)}`),
  get: (id) => apiRequest(`/orders/${id}`),
  create: (payload) => apiRequest('/orders', { method: 'POST', body: payload }),
  update: (id, payload) => apiRequest(`/orders/${id}`, { method: 'PATCH', body: payload }),
  transition: (id, status) =>
    apiRequest(`/orders/${id}/status`, { method: 'PATCH', body: { status } }),
  remove: (id) => apiRequest(`/orders/${id}`, { method: 'DELETE' }),
};

export const customersApi = {
  list: () => apiRequest('/customers'),
  get: (id) => apiRequest(`/customers/${id}`),
};

export const materialsApi = {
  list: () => apiRequest('/materials'),
};

export const machinesApi = {
  list: () => apiRequest('/machines'),
};

export const scheduleApi = {
  get: () => apiRequest('/schedule'),
  compare: () => apiRequest('/schedule/compare'),
  rebuild: (rule = 'ATCS') => apiRequest(`/schedule/rebuild?rule=${rule}`, { method: 'POST' }),
};

export const analyticsApi = {
  dashboard: () => apiRequest('/analytics/dashboard'),
  summary: () => apiRequest('/analytics/summary'),
};
