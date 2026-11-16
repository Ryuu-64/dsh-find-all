const ENTRY = 'find-all';
const ROW = '@ryuu-64/dsh-find-all#find-all';
const LOCALE = 'dsh-find-all.settings';
const FIELDS = ['defaultTitleOnly', 'defaultIncludeArchived'];

const en = {
  description: 'Defaults for full-text conversation search.',
  help: 'Choose the starting filters for full-text conversation search. You can still change them in the search dialog.',
  defaultTitleOnly: 'Search titles only by default',
  defaultIncludeArchived: 'Include archived conversations by default',
  reset: 'Use inherited value',
  unavailable: 'Search settings are unavailable.',
  readOnly: 'This profile’s settings are read-only.',
  save: 'Save',
  saving: 'Saving…',
  saveFailed: 'The Host did not confirm the save. Your edits are still here. Reopen this page to reload the saved values.',
};

const zh = {
  description: '对话全文搜索的默认选项。',
  help: '选择对话全文搜索的默认筛选条件。打开搜索后仍可调整。',
  defaultTitleOnly: '默认仅搜索标题',
  defaultIncludeArchived: '默认包含已归档对话',
  reset: '恢复继承值',
  unavailable: '搜索设置暂不可用。',
  readOnly: '当前配置的设置为只读。',
  save: '保存',
  saving: '正在保存…',
  saveFailed: '宿主未确认保存，编辑内容仍保留。重新打开本页可读取已保存的值。',
};

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
    if (!ui.SettingsFormModel || !ui.SettingsForm || !ui.Checkbox) return;
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
        const controls = FIELDS.map(field => h('div', {
          key: field,
          style: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
        },
          h(ui.Checkbox, {
            label: t(field), checked: fields[field].text === 'true', disabled,
            onChange: checked => actions.edit(field, String(checked)),
          }),
          fields[field].overridden ? h(ui.Button, {
            type: 'button', size: 'sm', variant: 'ghost', disabled,
            'aria-label': `${t('reset')} · ${t(field)}`,
            onClick: () => actions.resetField(field),
          }, t('reset')) : null));
        const labels = {
          unavailable: t('unavailable'), readOnly: t('readOnly'),
          save: t('save'), saving: t('saving'), saveFailed: t('saveFailed'),
        };
        return h(ui.SettingsForm, {
          labels, state: { ...shell, dirty: shell.dirty && shell.writable },
          onSave: actions.save, onDiscard: actions.discard,
        }, h('p', null, t('help')), controls);
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
