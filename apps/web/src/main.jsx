import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

async function api(url, options = {}) {
  const response = await fetch(url, options);
  const contentType = response.headers.get('content-type') ?? '';
  const payload = contentType.includes('json') ? await response.json() : await response.text();
  if (!response.ok) throw new Error(payload?.error || payload || 'Request failed.');
  return payload;
}

function Field({ label, children, hint }) {
  return <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}

function Notice({ tone = 'info', children }) {
  return <div className={`notice notice-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>{children}</div>;
}

function TimingNotice({ serviceDate }) {
  if (!serviceDate) return null;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(`${serviceDate}T00:00:00`);
  let businessDays = 0;
  const cursor = new Date(start);
  while (cursor < end) {
    cursor.setDate(cursor.getDate() + 1);
    if (cursor.getDay() !== 0 && cursor.getDay() !== 6) businessDays += 1;
  }
  if (businessDays < 3) return <Notice tone="warning">The service is fewer than 3 business days away. Federal GFE timing requirements may not apply, but you may still create an estimate.</Notice>;
  if (businessDays < 10) return <Notice>For services scheduled 3–9 business days ahead, the GFE is generally due within 1 business day after scheduling.</Notice>;
  return <Notice>For services scheduled at least 10 business days ahead, the GFE is generally due within 3 business days after scheduling.</Notice>;
}

function ServiceTable({ services, onRemove }) {
  const total = services.reduce((sum, item) => sum + Number(item.grossCharge), 0);
  return <div className="table-wrap"><table>
    <thead><tr><th>CPT</th><th>Description</th><th>Modifiers</th><th className="number">Expected charge</th>{onRemove && <th><span className="sr-only">Actions</span></th>}</tr></thead>
    <tbody>{services.map((item) => <tr key={item.id}><td className="code">{item.cptCode}</td><td>{item.description}{item.cdmCode && <small> · CDM {item.cdmCode}</small>}</td><td>{item.modifiers || '—'}</td><td className="number">{money.format(item.grossCharge)}</td>{onRemove && <td><button className="icon-button" type="button" onClick={() => onRemove(item.id)} aria-label={`Remove ${item.cptCode}`}>×</button></td>}</tr>)}
      {!services.length && <tr><td colSpan={onRemove ? 5 : 4} className="empty">No CPT services added.</td></tr>}
    </tbody><tfoot><tr><th colSpan="3">Total expected charges</th><th className="number">{money.format(total)}</th>{onRemove && <th />}</tr></tfoot>
  </table></div>;
}

function Estimator() {
  const [locations, setLocations] = useState([]);
  const [appointmentTypes, setAppointmentTypes] = useState([]);
  const [locationId, setLocationId] = useState('');
  const [appointmentTypeId, setAppointmentTypeId] = useState('');
  const [services, setServices] = useState([]);
  const [bundleState, setBundleState] = useState('idle');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [message, setMessage] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [form, setForm] = useState({ selfPayConfirmed: false, serviceDate: '', patientName: '', dateOfBirth: '', address: '', phone: '', email: '', representativeName: '', representativeContact: '', primaryService: '', diagnosisCode: '', diagnosisDescription: '', separateServices: '', notes: '' });

  useEffect(() => { api('/api/locations').then(setLocations).catch((error) => setMessage({ tone: 'error', text: error.message })); }, []);
  useEffect(() => {
    setAppointmentTypeId(''); setServices([]); setBundleState('idle'); setAppointmentTypes([]);
    if (locationId) api(`/api/locations/${locationId}/appointment-types`).then(setAppointmentTypes).catch((error) => setMessage({ tone: 'error', text: error.message }));
  }, [locationId]);

  async function loadBundle(id = appointmentTypeId) {
    setServices([]); setMessage(null);
    if (!locationId || !id) return;
    setBundleState('loading');
    try {
      const data = await api(`/api/locations/${locationId}/appointment-types/${id}/bundle`);
      setServices(data.items); setBundleState(data.items.length ? 'loaded' : 'empty');
      if (data.invalidItems.length) setMessage({ tone: 'warning', text: `${data.invalidItems.length} configured CPT item(s) are unavailable in the active CDM.` });
    } catch (error) { setBundleState('missing'); setMessage({ tone: 'warning', text: error.message }); }
  }

  useEffect(() => {
    if (query.trim().length < 2 || !locationId) { setResults([]); return undefined; }
    const controller = new AbortController();
    const timeout = setTimeout(() => api(`/api/locations/${locationId}/services?q=${encodeURIComponent(query.trim())}`, { signal: controller.signal }).then(setResults).catch((error) => { if (error.name !== 'AbortError') setMessage({ tone: 'error', text: error.message }); }), 250);
    return () => { clearTimeout(timeout); controller.abort(); };
  }, [query, locationId]);

  const selectedAppointment = appointmentTypes.find((item) => item.id === appointmentTypeId);
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.type === 'checkbox' ? event.target.checked : event.target.value }));
  const canGenerate = form.selfPayConfirmed && locationId && appointmentTypeId && services.length && form.patientName && form.dateOfBirth && form.serviceDate;

  async function generate(event) {
    event.preventDefault(); setGenerating(true); setMessage(null);
    try {
      const response = await fetch('/api/estimates/pdf', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        selfPayConfirmed: form.selfPayConfirmed, locationId, appointmentTypeId, serviceIds: services.map((item) => item.id), serviceDate: form.serviceDate,
        patient: { name: form.patientName, dateOfBirth: form.dateOfBirth, address: form.address, phone: form.phone, email: form.email },
        representative: { name: form.representativeName, contact: form.representativeContact }, primaryService: form.primaryService || selectedAppointment?.name,
        diagnoses: form.diagnosisCode ? [{ code: form.diagnosisCode, description: form.diagnosisDescription }] : [], separateServices: form.separateServices, notes: form.notes,
      }) });
      if (!response.ok) { const data = await response.json(); throw new Error(data.error); }
      const blob = await response.blob(); const url = URL.createObjectURL(blob); const link = document.createElement('a');
      link.href = url; link.download = response.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1] || 'good-faith-estimate.pdf'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage({ tone: 'success', text: 'The Good Faith Estimate was generated. Give the patient a copy and retain it according to organizational policy.' });
    } catch (error) { setMessage({ tone: 'error', text: error.message }); } finally { setGenerating(false); }
  }

  return <form onSubmit={generate} className="workflow">
    <section className="card intro-card"><div><p className="eyebrow">Scheduler workspace</p><h1>Good Faith Estimate</h1><p>Build an itemized estimate using the active gross charges for the selected facility.</p></div><label className="check"><input type="checkbox" checked={form.selfPayConfirmed} onChange={set('selfPayConfirmed')} /><span>I confirmed the patient is uninsured or will not submit this care to insurance.</span></label></section>
    {message && <Notice tone={message.tone}>{message.text}</Notice>}
    <section className="card"><div className="section-title"><span>1</span><div><h2>Choose the scheduled care</h2><p>The appointment type and location determine the standard CPT bundle.</p></div></div><div className="grid-2">
      <Field label="Service location"><select value={locationId} onChange={(event) => setLocationId(event.target.value)} required><option value="">Select a location</option>{locations.map((item) => <option key={item.id} value={item.id} disabled={!item.hasCdm}>{item.name}{!item.hasCdm ? ' — CDM not loaded' : ''}</option>)}</select></Field>
      <Field label="Appointment type"><select value={appointmentTypeId} onChange={(event) => { setAppointmentTypeId(event.target.value); loadBundle(event.target.value); }} disabled={!locationId} required><option value="">Select an appointment type</option>{appointmentTypes.map((item) => <option key={item.id} value={item.id}>{item.name}{!item.mappingId ? ' — no standard bundle' : ''}</option>)}</select></Field>
    </div>{bundleState === 'missing' && <Notice tone="warning">No standard bundle configured. Search and add at least one location CPT, or ask an administrator to configure this mapping.</Notice>}{appointmentTypeId && <button className="secondary small" type="button" onClick={() => loadBundle()}>Reload standard bundle</button>}</section>
    <section className="card"><div className="section-title"><span>2</span><div><h2>Review expected services</h2><p>Charges and quantities are locked to the active location CDM.</p></div></div><ServiceTable services={services} onRemove={(id) => setServices((current) => current.filter((item) => item.id !== id))} /><div className="search-box"><Field label="Add a CPT from this location" hint="Enter at least 2 characters."><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search CPT, CDM code, or description" /></Field>{!!results.length && <div className="search-results">{results.map((item) => <button type="button" key={item.id} disabled={services.some((service) => service.id === item.id)} onClick={() => { setServices((current) => [...current, item]); setQuery(''); setResults([]); }}><span><strong>{item.cptCode}</strong> {item.description}{item.cdmCode && ` · CDM ${item.cdmCode}`} · {item.modifiers || 'No modifiers'} · {item.setting}</span><span>{money.format(item.grossCharge)}</span></button>)}</div>}</div></section>
    <section className="card"><div className="section-title"><span>3</span><div><h2>Patient and appointment details</h2><p>Required to prepare the written estimate. This information is not retained by the application.</p></div></div><div className="grid-2">
      <Field label="Patient full name"><input value={form.patientName} onChange={set('patientName')} required /></Field><Field label="Date of birth"><input type="date" value={form.dateOfBirth} onChange={set('dateOfBirth')} required /></Field><Field label="Address"><input value={form.address} onChange={set('address')} /></Field><Field label="Phone"><input type="tel" value={form.phone} onChange={set('phone')} /></Field><Field label="Email"><input type="email" value={form.email} onChange={set('email')} /></Field><Field label="Expected service date"><input type="date" value={form.serviceDate} onChange={set('serviceDate')} required /></Field>
    </div><TimingNotice serviceDate={form.serviceDate} /><details><summary>Authorized representative (optional)</summary><div className="grid-2 details-grid"><Field label="Representative name"><input value={form.representativeName} onChange={set('representativeName')} /></Field><Field label="Representative contact"><input value={form.representativeContact} onChange={set('representativeContact')} /></Field></div></details></section>
    <section className="card"><div className="section-title"><span>4</span><div><h2>Clinical context</h2><p>Add information known at the time of scheduling.</p></div></div><Field label="Primary service"><input value={form.primaryService} onChange={set('primaryService')} placeholder={selectedAppointment?.name || ''} /></Field><div className="grid-2"><Field label="Diagnosis code (optional)"><input value={form.diagnosisCode} onChange={set('diagnosisCode')} placeholder="Example: Z12.31" /></Field><Field label="Diagnosis description"><input value={form.diagnosisDescription} onChange={set('diagnosisDescription')} /></Field></div><Field label="Items or services requiring separate scheduling"><textarea value={form.separateServices} onChange={set('separateServices')} rows="3" /></Field><Field label="Additional notes"><textarea value={form.notes} onChange={set('notes')} rows="3" /></Field></section>
    <section className="card review"><div><h2>Generate estimate</h2><p>The PDF is generated for download and is not saved by this application.</p></div><button className="primary" disabled={!canGenerate || generating}>{generating ? 'Generating…' : 'Download PDF estimate'}</button></section>
  </form>;
}

function AdminLogin({ onLogin }) {
  const [secret, setSecret] = useState(''); const [error, setError] = useState('');
  async function submit(event) { event.preventDefault(); try { setError(''); onLogin(await api('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret }) })); } catch (caught) { setError(caught.message); } }
  return <main className="admin-login"><form className="card" onSubmit={submit}><p className="eyebrow">Restricted</p><h1>Administrator sign in</h1><p>Enter the shared administrator secret to manage locations, CDMs, and appointment bundles.</p>{error && <Notice tone="error">{error}</Notice>}<Field label="Administrator secret"><input type="password" value={secret} onChange={(event) => setSecret(event.target.value)} autoFocus /></Field><button className="primary">Sign in</button></form></main>;
}

function OrganizationAdmin({ adminApi }) {
  const blank = { name: '', npi: '', tin: '', phone: '', email: '', addressLine1: '', addressLine2: '', city: '', state: '', postalCode: '' };
  const [form, setForm] = useState(blank); const [message, setMessage] = useState('');
  useEffect(() => { adminApi('/api/admin/organization').then((data) => data && setForm(data)); }, []);
  async function save(event) { event.preventDefault(); try { setForm(await adminApi('/api/admin/organization', { method: 'PUT', body: JSON.stringify(form) })); setMessage('Organization saved.'); } catch (error) { setMessage(error.message); } }
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  return <section className="card"><h2>Organization identity</h2><p>This information appears on every estimate.</p>{message && <Notice>{message}</Notice>}<form onSubmit={save}><div className="grid-2">{[['name','Legal organization name'],['npi','NPI'],['tin','TIN'],['phone','Phone'],['email','Email'],['addressLine1','Address line 1'],['addressLine2','Address line 2'],['city','City'],['state','State'],['postalCode','Postal code']].map(([key,label]) => <Field key={key} label={label}><input value={form[key] ?? ''} onChange={set(key)} required={!['email','addressLine2'].includes(key)} /></Field>)}</div><button className="primary">Save organization</button></form></section>;
}

function LocationsAdmin({ adminApi }) {
  const blank = { name: '', code: '', npi: '', phone: '', addressLine1: '', addressLine2: '', city: '', state: '', postalCode: '' };
  const [locations, setLocations] = useState([]); const [form, setForm] = useState(blank); const [selected, setSelected] = useState(''); const [file, setFile] = useState(null); const [preview, setPreview] = useState(null); const [history, setHistory] = useState([]); const [message, setMessage] = useState(null);
  const refresh = () => adminApi('/api/admin/locations').then(setLocations);
  useEffect(() => { refresh(); }, []);
  useEffect(() => { setPreview(null); if (selected) adminApi(`/api/admin/locations/${selected}/imports`).then(setHistory); else setHistory([]); }, [selected]);
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  async function add(event) { event.preventDefault(); try { await adminApi('/api/admin/locations', { method: 'POST', body: JSON.stringify(form) }); setForm(blank); setMessage({ tone:'success', text:'Location added.' }); refresh(); } catch (error) { setMessage({ tone:'error', text:error.message }); } }
  async function upload(path) { return adminApi(path, { method:'POST', body:file, headers:{ 'Content-Type':'text/csv', 'X-File-Name':file.name } }); }
  async function runPreview() { try { setMessage(null); setPreview(await upload(`/api/admin/locations/${selected}/imports/preview`)); } catch(error) { setMessage({tone:'error',text:error.message}); } }
  async function commit() { try { const result = await upload(`/api/admin/locations/${selected}/imports`); setMessage({tone:'success',text:`Published ${result.serviceCount} CPT charges.`}); setPreview(null); setFile(null); setHistory(await adminApi(`/api/admin/locations/${selected}/imports`)); refresh(); } catch(error) { setMessage({tone:'error',text:error.message}); } }
  return <div className="admin-grid"><section className="card"><h2>Locations</h2><form onSubmit={add}><div className="grid-2">{Object.entries({name:'Location name',code:'Short code',npi:'Location NPI',phone:'Phone',addressLine1:'Address line 1',addressLine2:'Address line 2',city:'City',state:'State',postalCode:'Postal code'}).map(([key,label]) => <Field key={key} label={label}><input value={form[key]} onChange={set(key)} required={['name','code','addressLine1','city','state','postalCode'].includes(key)} /></Field>)}</div><button className="primary">Add location</button></form><div className="list">{locations.map((item) => <button className={selected===item.id?'selected':''} type="button" key={item.id} onClick={() => setSelected(item.id)}><span><strong>{item.name}</strong><small>{item.code}</small></span><span className={`pill ${item.activeImportId?'ok':''}`}>{item.activeImportId?'CDM active':'No CDM'}</span></button>)}</div></section>
    <section className="card"><h2>Location CDM</h2>{message && <Notice tone={message.tone}>{message.text}</Notice>}{!selected ? <p>Select a location to manage its CDM.</p> : <><Field label="Location CSV"><input type="file" accept=".csv,text/csv" onChange={(event) => { setFile(event.target.files[0]); setPreview(null); }} /></Field><button type="button" className="secondary" disabled={!file} onClick={runPreview}>Validate and preview</button>{preview && <div className="preview"><h3>Import preview</h3><dl><div><dt>Rows</dt><dd>{preview.rowCount}</dd></div><div><dt>CPT services</dt><dd>{preview.serviceCount}</dd></div><div><dt>Skipped</dt><dd>{preview.skippedCount}</dd></div></dl>{preview.affectedBundles.length ? <Notice tone="warning">{preview.affectedBundles.length} appointment bundle(s) will contain unavailable CPTs after this import.</Notice> : <Notice tone="success">No appointment bundles will be invalidated.</Notice>}<button type="button" className="primary" onClick={commit}>Publish this CDM now</button></div>}<h3>Import history</h3><div className="history">{history.map((item) => <div key={item.id}><span><strong>{item.fileName}</strong><small>{new Date(item.createdAt).toLocaleString()} · {item.serviceCount} services</small></span>{item.isActive ? <span className="pill ok">Active</span> : <button type="button" className="text-button" onClick={async()=>{await adminApi(`/api/admin/locations/${selected}/imports/${item.id}/rollback`,{method:'POST'}); setMessage({tone:'success',text:'The selected CDM version is active.'}); setHistory(await adminApi(`/api/admin/locations/${selected}/imports`)); refresh();}}>Make active</button>}</div>)}</div></>}</section></div>;
}

function BundlesAdmin({ adminApi }) {
  const [locations,setLocations]=useState([]); const [types,setTypes]=useState([]); const [newType,setNewType]=useState(''); const [locationId,setLocationId]=useState(''); const [typeId,setTypeId]=useState(''); const [mappings,setMappings]=useState([]); const [items,setItems]=useState([]); const [query,setQuery]=useState(''); const [results,setResults]=useState([]); const [message,setMessage]=useState(null);
  const refreshTypes=()=>adminApi('/api/admin/appointment-types').then(setTypes);
  useEffect(()=>{adminApi('/api/admin/locations').then(setLocations);refreshTypes();},[]);
  useEffect(()=>{if(locationId)adminApi(`/api/admin/locations/${locationId}/mappings`).then(setMappings);else setMappings([]);setTypeId('');setItems([]);},[locationId]);
  useEffect(()=>{const mapping=mappings.find(item=>item.appointmentTypeId===typeId);setItems(mapping?.items??[]);},[typeId,mappings]);
  useEffect(()=>{if(query.length<2||!locationId){setResults([]);return undefined;}const timer=setTimeout(()=>api(`/api/locations/${locationId}/services?q=${encodeURIComponent(query)}`).then(setResults),250);return()=>clearTimeout(timer);},[query,locationId]);
  async function addType(event){event.preventDefault();try{await adminApi('/api/admin/appointment-types',{method:'POST',body:JSON.stringify({name:newType})});setNewType('');refreshTypes();setMessage({tone:'success',text:'Appointment type added.'});}catch(error){setMessage({tone:'error',text:error.message});}}
  async function save(){try{await adminApi(`/api/admin/locations/${locationId}/mappings/${typeId}`,{method:'PUT',body:JSON.stringify({items:items.map(({cptCode,modifiers,setting,cdmCode})=>({cptCode,modifiers,setting,cdmCode})),isActive:true})});setMappings(await adminApi(`/api/admin/locations/${locationId}/mappings`));setMessage({tone:'success',text:'Location-specific standard bundle saved.'});}catch(error){setMessage({tone:'error',text:error.message});}}
  function move(index,direction){setItems(current=>{const next=[...current];const target=index+direction;if(target<0||target>=next.length)return current;[next[index],next[target]]=[next[target],next[index]];return next;});}
  const selectedMapping=mappings.find(item=>item.appointmentTypeId===typeId);
  return <div className="admin-grid"><section className="card"><h2>Appointment types</h2><p>Appointment types are shared across locations.</p>{message&&<Notice tone={message.tone}>{message.text}</Notice>}<form className="inline-form" onSubmit={addType}><input value={newType} onChange={e=>setNewType(e.target.value)} placeholder="New appointment type" required/><button className="primary">Add</button></form><div className="list static">{types.map(item=><div key={item.id}><strong>{item.name}</strong><span><span className={`pill ${item.isActive?'ok':''}`}>{item.isActive?'Active':'Inactive'}</span><button type="button" className="text-button" onClick={async()=>{await adminApi(`/api/admin/appointment-types/${item.id}`,{method:'PATCH',body:JSON.stringify({isActive:!item.isActive})});refreshTypes();}}>{item.isActive?'Deactivate':'Activate'}</button></span></div>)}</div></section>
    <section className="card"><h2>Location-specific standard bundle</h2><div className="grid-2"><Field label="Location"><select value={locationId} onChange={e=>setLocationId(e.target.value)}><option value="">Select</option>{locations.filter(item=>item.isActive).map(item=><option value={item.id} key={item.id}>{item.name}</option>)}</select></Field><Field label="Appointment type"><select value={typeId} onChange={e=>setTypeId(e.target.value)} disabled={!locationId}><option value="">Select</option>{types.filter(item=>item.isActive).map(item=><option value={item.id} key={item.id}>{item.name}</option>)}</select></Field></div>{typeId&&<>{selectedMapping?.invalidItems?.length>0&&<Notice tone="warning">This bundle contains {selectedMapping.invalidItems.length} CPT item(s) unavailable in the active location CDM. Remove or replace them before saving.</Notice>}<div className="bundle-editor">{items.map((item,index)=><div key={JSON.stringify([item.cptCode, item.modifiers, item.setting, item.cdmCode])}><span className="handle">{index+1}</span><span><strong>{item.cptCode}</strong> {item.description||''}<small>{item.modifiers||'No modifiers'}{item.cdmCode && ` · CDM ${item.cdmCode}`}{item.setting && ` · ${item.setting}`}</small></span><span className="bundle-actions"><button type="button" onClick={()=>move(index,-1)} aria-label="Move up">↑</button><button type="button" onClick={()=>move(index,1)} aria-label="Move down">↓</button><button type="button" onClick={()=>setItems(current=>current.filter((_,i)=>i!==index))} aria-label="Remove">×</button></span></div>)}</div><div className="search-box"><Field label="Add CPT from active location CDM"><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search CPT, CDM code, or description"/></Field>{results.length>0&&<div className="search-results">{results.map(item=><button type="button" key={item.id} disabled={items.some(existing=>existing.cptCode===item.cptCode&&existing.modifiers===item.modifiers&&existing.setting===item.setting&&existing.cdmCode===item.cdmCode)} onClick={()=>{setItems(current=>[...current,item]);setQuery('');setResults([]);}}><span><strong>{item.cptCode}</strong> {item.description}{item.cdmCode && ` · CDM ${item.cdmCode}`} · {item.modifiers || 'No modifiers'} · {item.setting}</span><span>{money.format(item.grossCharge)}</span></button>)}</div>}</div><button type="button" className="primary" onClick={save}>Save this location bundle</button></>}</section></div>;
}

function Admin({ onExit }) {
  const [session,setSession]=useState(null); const [tab,setTab]=useState('organization');
  useEffect(()=>{api('/api/admin/session').then(setSession).catch(()=>{});},[]);
  if(!session)return <AdminLogin onLogin={setSession}/>;
  const adminApi=async(url,options={})=>api(url,{...options,headers:{...(options.body instanceof Blob?{}:{'Content-Type':'application/json'}),...(options.headers||{}),'X-CSRF-Token':session.csrfToken}});
  async function logout(){await adminApi('/api/admin/logout',{method:'POST'});setSession(null);onExit();}
  return <main className="admin-shell"><header className="admin-header"><div><p className="eyebrow">Configuration</p><h1>Estimator administration</h1></div><div><button className="secondary" onClick={onExit}>Scheduler view</button><button className="text-button" onClick={logout}>Sign out</button></div></header><nav className="tabs">{[['organization','Organization'],['locations','Locations & CDM'],['bundles','Appointment bundles']].map(([id,label])=><button key={id} className={tab===id?'active':''} onClick={()=>setTab(id)}>{label}</button>)}</nav>{tab==='organization'&&<OrganizationAdmin adminApi={adminApi}/>} {tab==='locations'&&<LocationsAdmin adminApi={adminApi}/>} {tab==='bundles'&&<BundlesAdmin adminApi={adminApi}/>}</main>;
}

function App() {
  const [admin,setAdmin]=useState(window.location.hash==='#admin');
  useEffect(()=>{const handler=()=>setAdmin(window.location.hash==='#admin');window.addEventListener('hashchange',handler);return()=>window.removeEventListener('hashchange',handler);},[]);
  if(admin)return <Admin onExit={()=>{window.location.hash='';setAdmin(false);}}/>;
  return <><header className="topbar"><a href="#" className="brand"><span>GFE</span><strong>Good Faith Estimator</strong></a><a href="#admin" className="admin-link">Administration</a></header><main className="page"><Estimator/></main><footer>Internal scheduling tool · Estimates are not retained by this application</footer></>;
}

createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>);
