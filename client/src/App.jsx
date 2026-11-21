import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell.jsx';
import { AuthProvider, useAuth } from './lib/auth.jsx';
import { ThemeProvider } from './lib/theme.jsx';
import LoginPage from './pages/LoginPage.jsx';
import OrdersPage from './pages/OrdersPage.jsx';
import PlaceholderPage from './pages/PlaceholderPage.jsx';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 15_000,
    },
  },
});

function ProtectedRoute({ children }) {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas font-mono text-xs text-ink-muted">
        Перевірка сесії...
      </div>
    );
  }
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  return <AppShell>{children}</AppShell>;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/" element={<Navigate to="/orders" replace />} />
              <Route
                path="/orders"
                element={
                  <ProtectedRoute>
                    <OrdersPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/planner"
                element={
                  <ProtectedRoute>
                    <PlaceholderPage
                      title="Планувальник черги (Гант)"
                      description="Діаграма Ганта на CSS Grid із переналаштуваннями, закріпленими слотами та порівнянням FIFO/EDD/SPT/ATCS буде реалізована у Фазі 6."
                    />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/machines"
                element={
                  <ProtectedRoute>
                    <PlaceholderPage
                      title="Верстати та графік ТО"
                      description="Керування парком обладнання, ставками амортизації та вікнами обслуговування буде додано у Фазі 6."
                    />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/materials"
                element={
                  <ProtectedRoute>
                    <PlaceholderPage
                      title="Матеріали та склад"
                      description="Облік залишків, списання у виробництво та прогноз дефіциту буде додано у Фазі 6."
                    />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/customers"
                element={
                  <ProtectedRoute>
                    <PlaceholderPage
                      title="Клієнти"
                      description="Реєстр замовників, історія угод і розрахунок середнього чека буде додано у Фазі 6."
                    />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/analytics"
                element={
                  <ProtectedRoute>
                    <PlaceholderPage
                      title="Аналітика"
                      description="Прибутковість по замовленнях, завантаженість обладнання та точність прогнозів буде додана у Фазі 6."
                    />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/settings"
                element={
                  <ProtectedRoute>
                    <PlaceholderPage
                      title="Налаштування майстерні"
                      description="Редагування ставок праці, коефіцієнтів ризику, маржі та матриці переналаштувань буде додано у Фазі 6."
                    />
                  </ProtectedRoute>
                }
              />
              <Route path="*" element={<Navigate to="/orders" replace />} />
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
