const ENTRY = 'find-all';
const ROW = '@ryuu-64/dsh-find-all#find-all';
const LOCALE = 'dsh-find-all.settings';
const FIELDS = ['defaultTitleOnly', 'defaultIncludeArchived'];

const en = {
  description: 'Defaults for full-text conversation search.',
  defaultTitleOnly: 'Search titles only by default',
  defaultTitleOnlyHint: 'When off, search matches titles and message text. Either mode can be selected in the search dialog.',
  defaultIncludeArchived: 'Include archived conversations by default',
  defaultIncludeArchivedHint: 'Archived conversations can appear in results. Unarchive a conversation to open it.',
  overridden: 'Overridden',
  reset: 'Reset to default',
  unavailable: 'Search settings are unavailable.',
  readOnly: 'This profile’s settings are read-only.',
  save: 'Save',
  saving: 'Saving…',
  saveFailed: 'The Host did not confirm the save. Your edits are still here. Reopen this page to reload the saved values.',
};

const zh = {
  description: '对话全文搜索的默认选项。',
  defaultTitleOnly: '默认仅搜索标题',
  defaultTitleOnlyHint: '关闭后同时搜索标题和正文。打开搜索窗口后也可以切换。',
  defaultIncludeArchived: '默认包含已归档对话',
  defaultIncludeArchivedHint: '让归档对话出现在搜索结果中。打开归档对话前需先取消归档。',
  overridden: '已覆盖',
  reset: '恢复默认',
  unavailable: '搜索设置暂不可用。',
  readOnly: '当前配置的设置为只读。',
  save: '保存',
  saving: '正在保存…',
  saveFailed: '宿主未确认保存，编辑内容仍保留。重新打开本页可读取已保存的值。',
};

const fieldRow = {
  display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16,
  fontSize: 13, lineHeight: 1.5, color: 'var(--dsw-alias-label-primary)',
};
const fieldActions = { display: 'flex', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 8 };
const fieldHint = { margin: 0, fontSize: 12, lineHeight: 1.5, color: 'var(--dsw-alias-label-tertiary)' };
const resetStyle = { height: 'auto', padding: 0, fontSize: 12, lineHeight: 1.5, color: 'var(--dsw-alias-label-secondary)' };

function booleanField(field) {
  return {
    field,
    format: value => value === true ? 'true' : 'false',
    parse: text => ({ kind: 'set', value: text === 'true' }),
  };
}

// Hosts before the live profile settings API still run the search plugin.
export function installConversationSearchSettings(ctx, react, ui) {
  let source;
  ctx.inject(['configForms', 'locale'], child => {
    const { configForms, locale } = child;
    if (typeof configForms?.whileServed !== 'function' || typeof locale?.register !== 'function') return;
    child.effect(() => {
      source = configForms.get(ENTRY);
      return () => { source = undefined; };
    });
    if (!ui.SettingsFormModel || !ui.SettingsForm || !ui.Switch || !ui.Tag) return;
    child.effect(() => locale.register(LOCALE, { en, zh }));
    child.effect(() => configForms.whileServed([ENTRY], () => {
      const model = new ui.SettingsFormModel(configForms.get(ENTRY), FIELDS.map(booleanField));
      const store = model.bind(() => ({
        shell: model.shell(),
        fields: Object.fromEntries(FIELDS.map(field => [field, model.field(field)])),
      }));
      const actions = model.actions();
      const h = react.createElement;

      function SearchSettings({ t, view }) {
        const { shell, fields } = react.useSyncExternalStore(store.subscribe, store.getSnapshot);
        if (view === 'summary') return t('description');
        const disabled = !shell.writable || shell.saving;
        const controls = FIELDS.map((field, index) => {
          const label = t(field);
          const value = fields[field];
          return h('div', { key: field, style: { display: 'grid', gap: 6, padding: '12px 0',
            borderTop: index ? '0.5px solid var(--dsw-alias-border-l2)' : undefined } },
          h('div', { style: fieldRow },
            h('span', { style: { flex: 1, minWidth: 0 } }, label),
            h('div', { style: fieldActions },
              value.overridden && h(ui.Tag, { tone: 'neutral' }, t('overridden')),
              value.overridden && h(ui.Button, {
                type: 'button', size: 'sm', variant: 'ghost', disabled, style: resetStyle,
                'aria-label': `${t('reset')} · ${label}`,
                onClick: () => actions.resetField(field),
              }, t('reset')),
              h(ui.Switch, { checked: value.text === 'true', disabled, label,
                onChange: checked => actions.edit(field, String(checked)) }))),
          h('p', { style: fieldHint }, t(`${field}Hint`)));
        });
        const labels = {
          unavailable: t('unavailable'), readOnly: t('readOnly'),
          save: t('save'), saving: t('saving'), saveFailed: t('saveFailed'),
        };
        return h(ui.SettingsForm, {
          labels, state: { ...shell, dirty: shell.dirty && shell.writable },
          onSave: actions.save, onDiscard: actions.discard,
        }, controls);
      }

      const stop = child.slots.inject('plugins.row.config', () => child.slots.register({
        name: 'plugins.row.config', key: ROW, locale: LOCALE,
      }, SearchSettings));
      return () => {
        stop();
        model.dispose();
      };
    }));
  });
  return () => {
    const snapshot = source?.getSnapshot();
    return snapshot?.status === 'ready' ? snapshot.value : undefined;
  };
}
