import { Link } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader.jsx';

export default function PlaceholderPage({ title, description }) {
  return (
    <div className="space-y-4">
      <PageHeader title={title} subtitle="Розділ у черзі реалізації Фази 6" />
      <div className="rounded-md border border-line bg-surface p-5">
        <p className="text-sm text-ink-secondary">{description}</p>
        <Link
          to="/orders"
          className="mt-3 inline-flex rounded border border-line-strong bg-subtle px-3 py-1.5 text-xs font-medium text-ink hover:bg-canvas"
        >
          Повернутися до реєстру замовлень
        </Link>
      </div>
    </div>
  );
}
