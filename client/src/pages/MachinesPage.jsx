import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { FormField } from '../components/FormField.jsx';
import { ConfirmDialog, Modal } from '../components/Modal.jsx';
import { Money } from '../components/Money.jsx';
import { PageHeader } from '../components/PageHeader.jsx';
import { StatCard } from '../components/StatCard.jsx';
import { StatusBadge } from '../components/StatusBadge.jsx';
import { machinesApi } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { MACHINE_TYPE_LABELS, formatDateTime } from '../lib/format.js';

const INPUT_CLASS =
  'h-9 w-full rounded-xl border border-line bg-surface px-2.5 text-sm text-ink outline-none focus:border-accent';

function toLocalDateTimeInput(date) {
  const d = date ? new Date(date) : new Date(Date.now() + 24 * 3600_000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function MachinesPage() {
  const { isOwner } = useAuth();
  const queryClient = useQueryClient();

  const [machineModal, setMachineModal] = useState(null); // null | { mode: 'create'|'edit', machine }
  const [mName, setMName] = useState('');
  const [mType, setMType] = useState('fdm_3d');
  const [mDepr, setMDepr] = useState(80);
  const [mPower, setMPower] = useState(0.35);
  const [mShiftStart, setMShiftStart] = useState(9);
  const [mShiftEnd, setMShiftEnd] = useState(18);
  const [mActive, setMActive] = useState(true);
  const [mNotes, setMNotes] = useState('');

  const [maintModalMachine, setMaintModalMachine] = useState(null);
  const [wTitle, setWTitle] = useState('Планове ТО');
  const [wStart, setWStart] = useState(() => toLocalDateTimeInput());
  const [wEnd, setWEnd] = useState(() => toLocalDateTimeInput(Date.now() + 26 * 3600_000));
  const [wNotes, setWNotes] = useState('');

  const [pendingDelete, setPendingDelete] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['machines'],
    queryFn: machinesApi.list,
  });

  const machines = data?.machines ?? [];
  const activeCount = machines.filter((m) => m.isActive).length;
  const totalSlots = machines.reduce((s, m) => s + (m._count?.scheduleEntries ?? 0), 0);
  const totalMaint = machines.reduce((s, m) => s + (m.maintenanceWindows?.length ?? 0), 0);

  const openMachineModal = (mode, machine = null) => {
    setErrorMsg('');
    if (machine) {
      setMName(machine.name);
      setMType(machine.type);
      setMDepr(machine.depreciationPerH);
      setMPower(machine.powerKw);
      setMShiftStart(machine.calendar?.shiftStartHour ?? 9);
      setMShiftEnd(machine.calendar?.shiftEndHour ?? 18);
      setMActive(machine.isActive);
      setMNotes(machine.notes ?? '');
    } else {
      setMName('');
      setMType('fdm_3d');
      setMDepr(80);
      setMPower(0.35);
      setMShiftStart(9);
      setMShiftEnd(18);
      setMActive(true);
      setMNotes('');
    }
    setMachineModal({ mode, machine });
  };

  const saveMachineMutation = useMutation({
    mutationFn: () => {
      const existingCal = machineModal?.machine?.calendar ?? {
        workDays: [1, 2, 3, 4, 5],
        holidays: [],
      };
      const payload = {
        name: mName.trim(),
        type: mType,
        depreciationPerH: Number(mDepr) || 0,
        powerKw: Number(mPower) || 0,
        calendar: {
          ...existingCal,
          shiftStartHour: Number(mShiftStart),
          shiftEndHour: Number(mShiftEnd),
        },
        isActive: mActive,
        notes: mNotes.trim() || null,
      };
      if (machineModal.mode === 'edit') {
        return machinesApi.update(machineModal.machine.id, payload);
      }
      return machinesApi.create(payload);
    },
    onSuccess: () => {
      setErrorMsg('');
      setMachineModal(null);
      queryClient.invalidateQueries({ queryKey: ['machines'] });
      queryClient.invalidateQueries({ queryKey: ['schedule'] });
    },
    onError: (err) => setErrorMsg(err.message || 'Не вдалося зберегти верстат'),
  });

  const addMaintMutation = useMutation({
    mutationFn: () =>
      machinesApi.addMaintenance(maintModalMachine.id, {
        title: wTitle.trim(),
        start: new Date(wStart).toISOString(),
        end: new Date(wEnd).toISOString(),
        notes: wNotes.trim() || null,
      }),
    onSuccess: () => {
      setErrorMsg('');
      setMaintModalMachine(null);
      queryClient.invalidateQueries({ queryKey: ['machines'] });
      queryClient.invalidateQueries({ queryKey: ['schedule'] });
    },
    onError: (err) => setErrorMsg(err.message || 'Не вдалося додати вікно ТО'),
  });

  const deleteMutation = useMutation({
    mutationFn: () => {
      if (pendingDelete.kind === 'machine') {
        return machinesApi.remove(pendingDelete.machine.id);
      }
      return machinesApi.removeMaintenance(pendingDelete.machineId, pendingDelete.window.id);
    },
    onSuccess: () => {
      setErrorMsg('');
      setPendingDelete(null);
      queryClient.invalidateQueries({ queryKey: ['machines'] });
      queryClient.invalidateQueries({ queryKey: ['schedule'] });
    },
    onError: (err) => {
      setErrorMsg(err.message || 'Помилка видалення');
      setPendingDelete(null);
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Верстати"
        count={machines.length}
        subtitle="Обладнання майстерні, годинні ставки амортизації та планові вікна обслуговування"
        actions={
          isOwner ? (
            <button
              type="button"
              onClick={() => openMachineModal('create')}
              className="inline-flex h-11 items-center gap-2 rounded-full bg-cta px-5 text-sm font-medium text-on-cta transition-opacity hover:opacity-90"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={2} />
              <span>Додати верстат</span>
            </button>
          ) : null
        }
      />

      {errorMsg ? (
        <div
          role="alert"
          style={{
            backgroundColor: 'var(--st-danger-bg)',
            color: 'var(--st-danger-fg)',
            borderColor: 'var(--st-danger-bd)',
          }}
          className="flex items-center justify-between rounded-2xl border px-4 py-2.5 text-xs"
        >
          <span>{errorMsg}</span>
          <button type="button" onClick={() => setErrorMsg('')} className="underline">
            Закрити
          </button>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <StatCard label="Усього верстатів" value={machines.length} hint="Парк обладнання" />
        <StatCard label="Активних" value={activeCount} hint="Доступні до планування" />
        <StatCard label="Робіт у плані" value={totalSlots} hint="Заплановано слотів" />
        <StatCard label="Вікон ТО" value={totalMaint} hint="Обслуговування" />
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {[0, 1].map((i) => (
            <div key={i} className="h-52 rounded-2xl border border-line bg-surface wp-skeleton" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {machines.map((m) => (
            <div
              key={m.id}
              className="min-w-0 space-y-3 rounded-2xl border border-line bg-surface p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="truncate text-base font-semibold text-ink">{m.name}</h2>
                    <StatusBadge
                      status={m.isActive ? 'ok' : 'done'}
                      label={m.isActive ? 'Активний' : 'Вимкнено'}
                    />
                  </div>
                  <div className="mt-0.5 font-mono text-xs text-ink-muted">
                    {MACHINE_TYPE_LABELS[m.type] ?? m.type} · зміна{' '}
                    {m.calendar?.shiftStartHour ?? 9}:00–{m.calendar?.shiftEndHour ?? 18}:00
                  </div>
                </div>
                <div className="text-right font-mono">
                  <div className="text-sm font-bold text-ink">
                    <Money value={m.hourlyRate} />/год
                  </div>
                  <div className="text-[11px] text-ink-muted">
                    аморт. {m.depreciationPerH} ₴ · {m.powerKw} кВт
                  </div>
                </div>
              </div>

              {m.notes ? <p className="text-xs text-ink-secondary">{m.notes}</p> : null}

              <div className="space-y-1.5 rounded-xl border border-line bg-subtle/40 p-3 text-xs">
                <div className="flex items-center justify-between font-medium text-ink-secondary">
                  <span>Вікна ТО ({m.maintenanceWindows?.length ?? 0})</span>
                  {isOwner ? (
                    <button
                      type="button"
                      onClick={() => {
                        setErrorMsg('');
                        setWTitle('Планове ТО');
                        setMaintModalMachine(m);
                      }}
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-accent hover:underline"
                    >
                      <CalendarPlus className="h-3.5 w-3.5" />
                      Додати ТО
                    </button>
                  ) : null}
                </div>
                {(m.maintenanceWindows ?? []).length === 0 ? (
                  <div className="text-[11px] text-ink-muted">Запланованих ТО немає.</div>
                ) : (
                  <div className="divide-y divide-line">
                    {m.maintenanceWindows.map((w) => (
                      <div key={w.id} className="flex items-center justify-between gap-2 py-1.5">
                        <div className="min-w-0">
                          <div className="truncate font-medium text-ink">{w.title}</div>
                          <div className="font-mono text-[11px] text-ink-muted">
                            {formatDateTime(w.start)} — {formatDateTime(w.end)}
                          </div>
                        </div>
                        {isOwner ? (
                          <button
                            type="button"
                            onClick={() =>
                              setPendingDelete({ kind: 'maint', machineId: m.id, window: w })
                            }
                            className="rounded p-1 text-ink-muted hover:text-ink"
                            aria-label="Видалити ТО"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {isOwner ? (
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs">
                  <span className="font-mono text-[11px] text-ink-muted">
                    Слотів у плані: {m._count?.scheduleEntries ?? 0}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => openMachineModal('edit', m)}
                      className="inline-flex items-center gap-1 rounded-xl border border-line-strong bg-surface px-3 py-1.5 font-medium text-ink hover:bg-subtle"
                    >
                      <Pencil className="h-3 w-3" />
                      Редагувати
                    </button>
                    {(m._count?.scheduleEntries ?? 0) === 0 ? (
                      <button
                        type="button"
                        onClick={() => setPendingDelete({ kind: 'machine', machine: m })}
                        className="rounded-xl border border-line px-2.5 py-1.5 text-ink-muted hover:border-line-strong hover:text-ink"
                      >
                        Видалити
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {/* Machine Form Modal */}
      <Modal
        open={Boolean(machineModal)}
        onClose={() => setMachineModal(null)}
        title={machineModal?.mode === 'edit' ? `Редагувати: ${machineModal.machine.name}` : 'Новий верстат'}
        maxWidth="max-w-lg"
        footer={
          <>
            <button
              type="button"
              onClick={() => setMachineModal(null)}
              className="rounded-xl border border-line-strong bg-surface px-4 py-2 text-xs font-medium text-ink hover:bg-subtle"
            >
              Скасувати
            </button>
            <button
              type="button"
              disabled={saveMachineMutation.isPending || mName.trim().length < 2}
              onClick={() => saveMachineMutation.mutate()}
              className="rounded-full bg-cta px-5 py-2 text-xs font-medium text-on-cta hover:opacity-90 disabled:opacity-50"
            >
              {saveMachineMutation.isPending ? 'Збереження...' : 'Зберегти'}
            </button>
          </>
        }
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label="Назва" required className="sm:col-span-2">
            <input type="text" value={mName} onChange={(e) => setMName(e.target.value)} className={INPUT_CLASS} />
          </FormField>
          <FormField label="Тип процесу">
            <select value={mType} onChange={(e) => setMType(e.target.value)} className={INPUT_CLASS}>
              {Object.entries(MACHINE_TYPE_LABELS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Стан" className="flex flex-col justify-end">
            <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-xl border border-line px-3 text-xs text-ink">
              <input
                type="checkbox"
                checked={mActive}
                onChange={(e) => setMActive(e.target.checked)}
                className="accent-[var(--accent)]"
              />
              <span>Активний верстат</span>
            </label>
          </FormField>
          <FormField label="Амортизація (₴/год)">
            <input
              type="number"
              min={0}
              step={1}
              value={mDepr}
              onChange={(e) => setMDepr(e.target.value)}
              className={`${INPUT_CLASS} font-mono`}
            />
          </FormField>
          <FormField label="Потужність (кВт)">
            <input
              type="number"
              min={0}
              step={0.05}
              value={mPower}
              onChange={(e) => setMPower(e.target.value)}
              className={`${INPUT_CLASS} font-mono`}
            />
          </FormField>
          <FormField label="Початок зміни (год)">
            <input
              type="number"
              min={0}
              max={23}
              value={mShiftStart}
              onChange={(e) => setMShiftStart(e.target.value)}
              className={`${INPUT_CLASS} font-mono`}
            />
          </FormField>
          <FormField label="Кінець зміни (год)">
            <input
              type="number"
              min={1}
              max={24}
              value={mShiftEnd}
              onChange={(e) => setMShiftEnd(e.target.value)}
              className={`${INPUT_CLASS} font-mono`}
            />
          </FormField>
          <FormField label="Опис" className="sm:col-span-2">
            <input type="text" value={mNotes} onChange={(e) => setMNotes(e.target.value)} className={INPUT_CLASS} />
          </FormField>
        </div>
      </Modal>

      {/* Maintenance Form Modal */}
      <Modal
        open={Boolean(maintModalMachine)}
        onClose={() => setMaintModalMachine(null)}
        title={maintModalMachine ? `Вікно ТО: ${maintModalMachine.name}` : ''}
        maxWidth="max-w-md"
        footer={
          <>
            <button
              type="button"
              onClick={() => setMaintModalMachine(null)}
              className="rounded-xl border border-line-strong bg-surface px-4 py-2 text-xs font-medium text-ink hover:bg-subtle"
            >
              Скасувати
            </button>
            <button
              type="button"
              disabled={addMaintMutation.isPending || wTitle.trim().length < 2}
              onClick={() => addMaintMutation.mutate()}
              className="rounded-full bg-cta px-5 py-2 text-xs font-medium text-on-cta hover:opacity-90 disabled:opacity-50"
            >
              Зберегти ТО
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <FormField label="Назва робіт" required>
            <input type="text" value={wTitle} onChange={(e) => setWTitle(e.target.value)} className={INPUT_CLASS} />
          </FormField>
          <FormField label="Початок" required>
            <input type="datetime-local" value={wStart} onChange={(e) => setWStart(e.target.value)} className={INPUT_CLASS} />
          </FormField>
          <FormField label="Завершення" required>
            <input type="datetime-local" value={wEnd} onChange={(e) => setWEnd(e.target.value)} className={INPUT_CLASS} />
          </FormField>
          <FormField label="Примітка">
            <input type="text" value={wNotes} onChange={(e) => setWNotes(e.target.value)} className={INPUT_CLASS} />
          </FormField>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onClose={() => setPendingDelete(null)}
        isPending={deleteMutation.isPending}
        danger
        title={pendingDelete?.kind === 'machine' ? 'Видалити верстат?' : 'Видалити вікно ТО?'}
        message={
          pendingDelete?.kind === 'machine'
            ? `Верстат «${pendingDelete.machine.name}» буде видалено.`
            : `Вікно «${pendingDelete?.window?.title ?? ''}» буде видалено.`
        }
        confirmLabel="Видалити"
        onConfirm={() => deleteMutation.mutate()}
      />
    </div>
  );
}
