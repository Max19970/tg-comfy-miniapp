export function Field({ label, children, hint }) {
  return <label className="field"><span>{label}</span>{children}{hint && <em>{hint}</em>}</label>;
}

export function Select({ value, onChange, options = [], placeholder }) {
  return (
    <select value={value || ''} onChange={(e) => onChange(e.target.value)}>
      {!value && <option value="">{placeholder || 'Выбрать'}</option>}
      {options.map((item) => <option key={item} value={item}>{item}</option>)}
    </select>
  );
}
