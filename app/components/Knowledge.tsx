'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { BookOpen, FileText, Printer, Search, ArrowRight, Check, GraduationCap, Clock3, Download, ShieldCheck, ListChecks, ExternalLink } from 'lucide-react';
import content from '../../lib/legal-content.json';
import qualityReport from '../../lib/quality-report.json';
import { Modal, Field, SectionHead, External, Details, downloadBlob } from './ui';

type KnowledgeSection = 'documents' | 'training' | 'compliance' | 'quality';
type Props = {
  section: KnowledgeSection;
  completed: string[];
  onComplete: (id: string) => Promise<void>;
  notify: (message: string) => void;
};
type PrintRequest = { kind: 'document' | 'form'; id: string; request: number; blank?: boolean };
type Question = { question: string; options: string[]; correct: number; explanation: string };

const questions: Record<string, Question[]> = {
  'TR-01': [
    { question: 'Кое време показва кога е наблюдавана реката?', options: ['Часът на обновяване на страницата.', 'Времето на измерването от сензора.', 'Часът на последния вход в профила.'], correct: 1, explanation: 'Времето на измерване, времето на получаване и обновяването на екрана са различни.' },
    { question: 'Как се тълкува водното ниво на станцията?', options: ['Винаги като дълбочина на реката.', 'Като височина спрямо определената отправна нула.', 'Като водно количество в кубични метри за секунда.'], correct: 1, explanation: 'Нивото е спрямо отправната нула на конкретната станция.' },
    { question: 'Станцията няма връзка. Какво може да се заключи?', options: ['Реката е безопасна.', 'Нивото е нула.', 'Липсват актуални данни; последното наблюдение се показва с часа му.'], correct: 2, explanation: 'Техническо прекъсване не доказва липса на хидроложки риск.' }
  ],
  'TR-02': [
    { question: 'Кои станции може да управлява общински представител?', options: ['Всички, които вижда на картата.', 'Разрешените станции на своята община.', 'Всяка станция, ако промени адреса на заявката.'], correct: 1, explanation: 'Правата се проверяват по служебното членство и териториалния обхват.' },
    { question: 'Как се поправя погрешно измерване?', options: ['Изтрива се оригиналът.', 'Променя се без бележка.', 'Добавя се проследима корекция с причина, като оригиналът се запазва.'], correct: 2, explanation: 'Историята трябва да позволява проследяване на първичния запис и корекцията.' },
    { question: 'Замества ли системната роля необходимото експертно одобрение?', options: ['Не; правото в приложението и експертното решение имат различна функция.', 'Да, ако ролята е администратор.', 'Да, ако точката е в собствената община.'], correct: 0, explanation: 'Достъпът до действие не удостоверява инженерна или административна компетентност.' }
  ],
  'TR-03': [
    { question: 'Какво проверява дежурният при нов сигнал?', options: ['Само цвета на маркера.', 'Само името на общината.', 'Станцията, времето, качеството и наличните свързани наблюдения.'], correct: 2, explanation: 'Решението изисква контекст и проверка на актуалността.' },
    { question: 'Какво се прави при прекъсване след сигнал за високо ниво?', options: ['Сигналът автоматично се отменя.', 'Добавя се технически проблем и се следва редът за ескалация.', 'Стойността се заменя с нула.'], correct: 1, explanation: 'Липсата на нови данни не отстранява вече установения повод за проверка.' },
    { question: 'Какво представлява техническият сигнал в приложението?', options: ['Информация за проверка и действия по утвърдения ред.', 'Автоматична заповед за евакуация.', 'Доказателство, че населението е уведомено.'], correct: 0, explanation: 'Официалното предупреждение и решенията са на компетентните органи.' }
  ],
  'TR-04': [
    { question: 'Какво трябва да придружава извадката?', options: ['Само числата.', 'Филтри, период, единици, времена и качество на данните.', 'Личните контакти на всички потребители.'], correct: 1, explanation: 'Метаданните позволяват правилно тълкуване и проверка на извадката.' },
    { question: 'Кога пакетът може да се отбележи като изпратен?', options: ['Веднага след натискане на „Експорт“.', 'Когато е избран получател.', 'След действително предаване по определения канал и запис на доказателство.'], correct: 2, explanation: 'Подготвен файл не доказва изпращане или получаване.' },
    { question: 'Как се задава получателят на официални данни?', options: ['Проверяват се институцията, основанието и служебният получател.', 'Използва се първият намерен личен имейл.', 'Изпраща се до всеки доставчик от каталога.'], correct: 0, explanation: 'Получателят и допустимият обхват се установяват преди предаването.' }
  ],
  'TR-05': [
    { question: 'Създава ли вътрешната заявка автоматично договор с доставчик?', options: ['Да, при избран модел.', 'Да, при техническо одобрение.', 'Не; възлагането и договорът се оформят отделно.'], correct: 2, explanation: 'Заявката описва потребността и преминава през съответния ред за одобрение и възлагане.' },
    { question: 'Как се записва непотвърден гаранционен срок?', options: ['„За договаряне“ до получаване на конкретни условия.', 'Автоматично 24 месеца за всяка общинска покупка.', '„Пожизнена гаранция“.'], correct: 0, explanation: 'Общинската покупка изисква проверка на офертата, договора и приложимите условия.' },
    { question: 'Какво се проверява при документите за CE?', options: ['Само логото на сайта.', 'Декларацията за точния модел и конфигурация и посочените приложими изисквания.', 'Дали приложението има зелен статус.'], correct: 1, explanation: 'Съответствието се доказва с документи за съответния продукт и конфигурация.' }
  ],
  'TR-06': [
    { question: 'Достатъчен ли е обикновен експорт като резервно копие на цялата система?', options: ['Да, ако съдържа нивата.', 'Не; възстановяват се и конфигурация, права и журнал.', 'Да, ако файлът е от днес.'], correct: 1, explanation: 'Пълното възстановяване включва необходимите данни и състоянието на услугата.' },
    { question: 'Как се определя графикът за обслужване?', options: ['От един и същ законов интервал за всички уреди.', 'Само когато има видима повреда.', 'Според модела, указанията, средата, критичността и резултатите.'], correct: 2, explanation: 'Графикът се утвърждава за конкретната конфигурация и условия.' },
    { question: 'Как се записва преместване на станция?', options: ['С история на местоположението и период на действие.', 'Всички минали измервания получават новите координати.', 'Със заличаване на старата станция и данните ѝ.'], correct: 0, explanation: 'Историческите наблюдения трябва да останат свързани с действителните си условия.' }
  ]
};

function SourceLinks({ ids }: { ids: string[] }) {
  const selected = content.sources.filter(source => ids.includes(source.id));
  if (!selected.length) return null;
  return <div className="knowledge-sources"><span className="eyebrow">Основание и източници</span>{selected.map(source => <div key={source.id}><External href={source.url}>{source.title}</External></div>)}</div>;
}

function fold(value: string) { return value.toLocaleLowerCase('bg-BG').trim(); }
function matching(query: string, ...values: string[]) { return !query || fold(values.join(' ')).includes(fold(query)); }
function formKey(id: string, section: number, field: number) { return `${id}:${section}:${field}`; }

export default function Knowledge({ section, completed, onComplete, notify }: Props) {
  const [query, setQuery] = useState('');
  const [documentType, setDocumentType] = useState<'all' | 'manuals' | 'forms'>('all');
  const [complianceTab, setComplianceTab] = useState<'framework' | 'standards' | 'sources'>('framework');
  const [qualityTab, setQualityTab] = useState<'requirements' | 'tests' | 'release'>('requirements');
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [formId, setFormId] = useState<string | null>(null);
  const [trainingId, setTrainingId] = useState<string | null>(null);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [checked, setChecked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedLocally, setSavedLocally] = useState<string[]>([]);
  const [printRequest, setPrintRequest] = useState<PrintRequest | null>(null);

  useEffect(() => { setQuery(''); setDocumentId(null); setFormId(null); setTrainingId(null); }, [section]);
  useEffect(() => {
    if (!printRequest) return;
    const finish = () => { document.body.classList.remove('printing-knowledge'); setPrintRequest(null); };
    document.body.classList.add('printing-knowledge');
    window.addEventListener('afterprint', finish);
    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => { secondFrame = requestAnimationFrame(() => window.print()); });
    return () => { cancelAnimationFrame(firstFrame); cancelAnimationFrame(secondFrame); window.removeEventListener('afterprint', finish); document.body.classList.remove('printing-knowledge'); };
  }, [printRequest]);

  const completeIds = useMemo(() => new Set([...completed, ...savedLocally]), [completed, savedLocally]);
  const completedCount = content.training.filter(module => completeIds.has(module.id)).length;
  const selectedDocument = content.documents.find(document => document.id === documentId);
  const selectedForm = content.forms.find(form => form.id === formId);
  const selectedTraining = content.training.find(module => module.id === trainingId);
  const currentQuestions = trainingId ? questions[trainingId] || [] : [];
  const correctCount = currentQuestions.filter((question, index) => answers[index] === question.correct).length;
  const passed = checked && currentQuestions.length > 0 && correctCount === currentQuestions.length;
  const printedDocument = printRequest?.kind === 'document' ? content.documents.find(document => document.id === printRequest.id) : undefined;
  const printedForm = printRequest?.kind === 'form' ? content.forms.find(form => form.id === printRequest.id) : undefined;
  const manuals = content.documents.filter(document => matching(query, document.id, document.title, document.category, ...document.sections.map(part => part.body)));
  const forms = content.forms.filter(form => matching(query, form.id, form.title, form.category, form.purpose));
  const modules = content.training.filter(module => matching(query, module.id, module.title, module.audience, module.outcome));
  const requirements = content.projectRequirements.requirements.filter(item => matching(query, item.id, item.module, item.requirement, item.acceptance_criterion, item.test_id));

  function print(kind: 'document' | 'form', id: string, blank = false) { setPrintRequest({ kind, id, request: Date.now(), blank }); }
  function openTraining(id: string) { setTrainingId(id); setAnswers({}); setChecked(false); setSaving(false); }
  function checkAnswers() {
    if (Object.keys(answers).length !== currentQuestions.length) { notify('Изберете отговор на всеки въпрос.'); return; }
    setChecked(true);
  }
  async function saveCompletion() {
    if (!selectedTraining || !passed || saving) return;
    setSaving(true);
    try {
      await onComplete(selectedTraining.id);
      setSavedLocally(previous => previous.includes(selectedTraining.id) ? previous : [...previous, selectedTraining.id]);
      notify('Преминаването на обучението е записано.');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Преминаването не беше записано. Опитайте отново.');
    } finally { setSaving(false); }
  }
  function exportRequirements() {
    downloadBlob(new Blob([JSON.stringify({ ...content.projectRequirements, exportedAt: new Date().toISOString() }, null, 2)], { type: 'application/json;charset=utf-8' }), 'RiverGuard_iziskvania.json');
    notify('Матрицата на изискванията е подготвена за изтегляне.');
  }
  function exportQualityReport() {
    downloadBlob(new Blob([JSON.stringify(qualityReport, null, 2)], { type: 'application/json;charset=utf-8' }), `RiverGuard_protokol_avtomatichni_proverki_${qualityReport.executedAt.slice(0, 10)}.json`);
    notify('Пълният протокол от автоматичните проверки е подготвен за изтегляне.');
  }

  const search = <Field label="Търсене"><span className="knowledge-search"><Search size={16} aria-hidden="true" /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Заглавие, тема или идентификатор…" /></span></Field>;

  return <>
    <div className="knowledge-screen">
      {section === 'documents' && <>
        <SectionHead eyebrow="Работа със системата" title="Документи и формуляри" description="Практични процедури, ясни отговорности и готови работни образци за попълване и печат." actions={<span className="badge">{content.documents.length} ръководства · {content.forms.length} формуляра</span>} />
        <div className="card"><div className="card-body knowledge-controls"><div className="form-grid">{search}<div className="form-actions" aria-label="Вид документ">{([['all', 'Всички'], ['manuals', 'Ръководства'], ['forms', 'Формуляри']] as const).map(([value, label]) => <button className={`button ${documentType === value ? 'primary' : 'secondary'}`} key={value} aria-pressed={documentType === value} onClick={() => setDocumentType(value)}>{label}</button>)}</div></div></div></div>
        {(documentType === 'all' || documentType === 'manuals') && <section aria-label="Ръководства"><div className="section-head"><div><h2>Ръководства и процедури</h2><p className="muted">От първото измерване до приключения сервизен случай.</p></div></div><div className="content-grid">{manuals.map(document => <article className="card" key={document.id}><div className="card-body"><div className="document-row"><BookOpen size={21} /><span className="eyebrow">{document.id} · {document.category}</span></div><h3>{document.title}</h3><p className="muted">Версия {document.version} · {document.readMinutes} мин четене</p><div className="form-actions"><button className="button secondary" onClick={() => setDocumentId(document.id)}>Прочети <ArrowRight size={15} /></button><button className="button secondary" aria-label={`Печат: ${document.title}`} onClick={() => print('document', document.id)}><Printer size={15} /> Печат</button></div></div></article>)}</div>{!manuals.length && <p className="notice">Няма ръководства, които отговарят на търсенето.</p>}</section>}
        {(documentType === 'all' || documentType === 'forms') && <section aria-label="Работни формуляри"><div className="section-head"><div><h2>Работни формуляри</h2><p className="muted">Попълнете образеца и изберете печат или запазване като PDF от прозореца за печат.</p></div></div><div className="content-grid">{forms.map(form => <article className="card" key={form.id}><div className="card-body"><div className="document-row"><FileText size={21} /><span className="eyebrow">{form.id} · {form.category}</span></div><h3>{form.title}</h3><p className="muted">{form.purpose}</p><div className="form-actions"><button className="button secondary" onClick={() => setFormId(form.id)}>Попълни образеца <ArrowRight size={15} /></button><button className="button secondary" aria-label={`Печат на празен образец: ${form.title}`} onClick={() => print('form', form.id, true)}><Printer size={15} /> Празен образец</button></div></div></article>)}</div>{!forms.length && <p className="notice">Няма формуляри, които отговарят на търсенето.</p>}<p className="notice">{content.meta.formsNotice}</p></section>}
      </>}

      {section === 'training' && <>
        <SectionHead eyebrow="Подготовка на екипа" title="Обучения" description="Кратки модули с практически задачи и проверка на разбирането за ежедневната работа." actions={<span className="badge"><GraduationCap size={16} /> {completedCount} от {content.training.length} преминати</span>} />
        <div className="card"><div className="card-body"><div className="document-row"><ListChecks size={22} /><div><strong>Вашият напредък</strong><p className="muted">Резултатът се записва след успешна самопроверка. Записът не е удостоверение за професионална квалификация.</p></div></div><progress className="learning-progress" value={completedCount} max={content.training.length} aria-label="Преминати обучения" /></div></div>
        <div className="content-grid">{modules.map(module => <article className="card" key={module.id}><div className="card-body"><div className="document-row"><span className="eyebrow">{module.id}</span><span className="badge">{completeIds.has(module.id) ? <><Check size={14} /> Преминато</> : <><Clock3 size={14} /> {module.durationMinutes} мин</>}</span></div><h3>{module.title}</h3><p className="muted">{module.audience}</p><p>{module.outcome}</p><button className={`button ${completeIds.has(module.id) ? 'secondary' : 'primary'}`} onClick={() => openTraining(module.id)}>{completeIds.has(module.id) ? 'Прегледай отново' : 'Започни обучението'} <ArrowRight size={15} /></button></div></article>)}</div>
      </>}

      {section === 'compliance' && <>
        <SectionHead eyebrow="Отговорно внедряване" title="Правила и съответствие" description="Приложимата рамка, техническите стандарти и доказателствата, които се събират за всеки продукт и обект." actions={<span className="badge">Проверка на източниците · 05.11.2026</span>} />
        <div className="notice"><ShieldCheck size={19} /><span>Приложимостта се определя за реалния оператор, мястото и оборудването. Този регистър не удостоверява сертификация на демонстрационната система.</span></div>
        <div className="form-actions" aria-label="Раздел на съответствието">{([['framework', 'Нормативна рамка'], ['standards', 'Стандарти'], ['sources', 'Официални източници']] as const).map(([value, label]) => <button key={value} className={`button ${complianceTab === value ? 'primary' : 'secondary'}`} aria-pressed={complianceTab === value} onClick={() => setComplianceTab(value)}>{label}</button>)}</div>
        {complianceTab === 'framework' && <><div className="content-grid">{content.legalFramework.map(item => <article className="card" key={item.id}><div className="card-body"><span className="eyebrow">{item.category}</span><h3>{item.title}</h3><span className="badge">{item.status}</span><p>{item.text}</p><Details title="Как се прилага в проекта"><p>{item.application}</p><SourceLinks ids={item.sourceIds} /></Details></div></article>)}</div><div className="card"><div className="card-body"><h3>Доставчици, гаранции и компенсации</h3><p>{content.contracts.catalogueStatement}</p><Details title="Какво се уточнява в договора"><ul className="checklist">{content.contracts.requiredFields.map(field => <li key={field}>{field}</li>)}</ul><p className="muted">{content.contracts.slaStatement}</p></Details></div></div></>}
        {complianceTab === 'standards' && <div className="content-grid">{content.standards.map(standard => <article className="card" key={standard.id}><div className="card-body"><span className="eyebrow">{standard.classification}</span><h3>{standard.name}</h3><p>{standard.scope}</p><Details title="Изисквано доказателство" open><p>{standard.evidence}</p><p className="muted">{standard.claim}</p><SourceLinks ids={standard.sourceIds} /></Details></div></article>)}</div>}
        {complianceTab === 'sources' && <><div className="card"><div className="card-body"><p>{content.meta.sourceNote}</p>{search}</div></div><div className="card"><div className="card-body">{content.sources.filter(source => matching(query, source.id, source.title, source.publisher, source.reference)).map(source => <div className="document-row" key={source.id}><ExternalLink size={17} /><div><span className="eyebrow">{source.id} · {source.publisher}</span><h3><External href={source.url}>{source.title}</External></h3><p className="muted">{source.reference}{'version' in source && source.version ? ` · ${source.version}` : ''}</p></div></div>)}</div></div></>}
      </>}

      {section === 'quality' && <>
        <SectionHead eyebrow="От пример към изисквания" title="Качество и приемане" description="Връзка между потребност, измерим критерий и проверка — основа за следващата версия на проектната документация." actions={<button className="button secondary" onClick={exportRequirements}><Download size={16} /> Изтегли изискванията</button>} />
        <section aria-labelledby="automated-checks-title">
          <div className="card">
            <div className="card-header">
              <div className="heading-with-icon"><ShieldCheck size={19} aria-hidden="true" /><h2 id="automated-checks-title">Изпълнени автоматични проверки</h2></div>
              <button className="button secondary" onClick={exportQualityReport}><Download size={16} aria-hidden="true" /> Изтегли пълния протокол</button>
            </div>
            <div className="card-body">
              <p className="muted">Изпълнени на <time dateTime={qualityReport.executedAt}>{new Intl.DateTimeFormat('bg-BG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Sofia' }).format(new Date(qualityReport.executedAt))}</time> · българско време.</p>
              <div className="stats-grid" aria-label="Резултати от автоматичните проверки">
                <div className="stat-card"><div className="stat-label"><span>Успешни проверки</span><Check size={18} aria-hidden="true" /></div><div className="stat-value">{qualityReport.passed}/{qualityReport.total}</div><div className="stat-foot"><span>Действително изпълнен набор</span></div></div>
                {qualityReport.groups.map(group => <div className="stat-card" key={group.file}><div className="stat-label"><span>{group.name}</span><ListChecks size={18} aria-hidden="true" /></div><div className="stat-value">{group.passed}</div><div className="stat-foot"><span>{group.passed} от {group.total} успешни</span></div></div>)}
                <div className="stat-card"><div className="stat-label"><span>Неуспешни проверки</span></div><div className="stat-value">{qualityReport.failed}</div><div className="stat-foot"><span>{qualityReport.skipped} пропуснати</span></div></div>
              </div>
              <p><strong>Проверен обхват:</strong> {qualityReport.verificationScope}</p>
              <p><span className={`badge ${qualityReport.typecheck.result === 'passed' ? 'normal' : 'critical'}`}>Проверка на типовете: {qualityReport.typecheck.result === 'passed' ? 'успешна' : 'неуспешна'}</span></p>
              <Details title="Среда и граници на проверката"><p>{qualityReport.environment}</p><p>Команда за изпълнение: <code>{qualityReport.command}</code></p><ul className="checklist">{qualityReport.limitations.map(limitation => <li key={limitation}>{limitation}</li>)}</ul></Details>
              <Details title={`Резултат за всяка от ${qualityReport.total} проверки`}>
                <div className="table-wrap"><table><caption className="muted">Резултати от записаното изпълнение на автоматичните проверки.</caption><thead><tr><th scope="col">Проверка</th><th scope="col">Вид</th><th scope="col">Резултат</th></tr></thead><tbody>{qualityReport.checks.map(check => <tr key={check.id}><td><strong>{check.id}</strong><br />{check.name}</td><td>{check.kind === 'api' ? 'Интеграционна API' : check.kind === 'inventory' ? 'Оборудване и канали' : 'Домейн логика'}</td><td><span className={`badge ${check.status === 'passed' ? 'normal' : 'critical'}`}>{check.status === 'passed' ? 'Успешна' : 'Неуспешна'}</span></td></tr>)}</tbody></table></div>
              </Details>
            </div>
          </div>
        </section>
        <div className="form-actions" aria-label="Раздел за качество">{([['requirements', 'Матрица на изискванията'], ['tests', 'Ръчни приемателни сценарии'], ['release', 'Преди внедряване']] as const).map(([value, label]) => <button key={value} className={`button ${qualityTab === value ? 'primary' : 'secondary'}`} aria-pressed={qualityTab === value} onClick={() => setQualityTab(value)}>{label}</button>)}</div>
        {qualityTab === 'requirements' && <><div className="card"><div className="card-body"><div className="form-grid">{search}<div><span className="badge">{requirements.length} изисквания · за утвърждаване</span><p className="muted">Основа на матрицата: предоставеното PMBOK, 6. издание, раздел 5.2.3.2.</p></div></div></div></div><div className="card table-wrap"><table><caption className="muted">Проектни изисквания и критерии за приемане. Наличието на сценарий не означава изпълнен тест.</caption><thead><tr><th scope="col">ID / модул</th><th scope="col">Изискване</th><th scope="col">Критерий за приемане</th><th scope="col">Тест</th></tr></thead><tbody>{requirements.map(item => <tr key={item.id}><td><strong>{item.id}</strong><br /><span className="muted">{item.module}</span></td><td>{item.requirement}</td><td>{item.acceptance_criterion}</td><td><span className="badge">{item.test_id}</span></td></tr>)}</tbody></table>{!requirements.length && <p className="notice">Няма изисквания по зададеното търсене.</p>}</div></>}
        {qualityTab === 'tests' && <><div className="section-head"><div><h2>Ръчни проверки за приемане</h2><p className="muted">Сценарии за съвместно изпълнение с възложителя и отговорните специалисти.</p></div><span className="badge proposed">Очакват изпълнение и приемане</span></div><p className="notice">За тези ръчни сценарии още няма протокол за изпълнение и решение за приемане. Те се отчитат отделно от {qualityReport.total}-те автоматични проверки по-горе.</p><div className="content-grid">{content.acceptanceTests.map(test => <article className="card" key={test.id}><div className="card-body"><span className="eyebrow">{test.id} · {test.area}</span><h3>{test.scenario}</h3><p><strong>Очакван резултат:</strong> {test.expected}</p><span className="badge proposed">Предстои ръчна проверка</span></div></article>)}</div></>}
        {qualityTab === 'release' && <><p className="notice">Въвеждането в реална експлоатация се приема след събиране и проверка на посочените доказателства.</p><div className="content-grid">{content.releaseChecklist.map(item => <article className="card" key={item.id}><div className="card-body"><span className="eyebrow">{item.id} · {item.area}</span><h3>{item.requirement}</h3><p><strong>Отговорник:</strong> {item.owner}</p><p className="muted"><strong>Доказателство:</strong> {item.evidence}</p></div></article>)}</div></>}
      </>}
    </div>

    {selectedDocument && <Modal title={selectedDocument.title} wide onClose={() => setDocumentId(null)}><div className="prose"><p className="eyebrow">{selectedDocument.id} · версия {selectedDocument.version} · {selectedDocument.status}</p>{selectedDocument.sections.map(part => <section key={part.title}><h3>{part.title}</h3><p>{part.body}</p></section>)}<SourceLinks ids={selectedDocument.sourceIds} /></div><div className="form-actions"><button className="button primary" onClick={() => print('document', selectedDocument.id)}><Printer size={16} /> Печат / запази PDF</button><button className="button secondary" onClick={() => setDocumentId(null)}>Затвори</button></div></Modal>}

    {selectedForm && <Modal title={selectedForm.title} wide onClose={() => setFormId(null)}><p className="eyebrow">{selectedForm.id} · работен образец · версия 1.0</p><p>{selectedForm.purpose}</p><p className="notice">{selectedForm.notice}</p>{selectedForm.sections.map((part, sectionIndex) => <section key={part.title}><h3>{part.title}</h3><div className="form-grid">{part.fields.map((field, fieldIndex) => <Field label={field} key={field}><textarea rows={2} value={formValues[formKey(selectedForm.id, sectionIndex, fieldIndex)] || ''} onChange={event => setFormValues(previous => ({ ...previous, [formKey(selectedForm.id, sectionIndex, fieldIndex)]: event.target.value }))} placeholder="Попълнете при необходимост" /></Field>)}</div></section>)}<h3>Лица и подписи</h3><div className="form-grid">{selectedForm.signatures.map((signature, index) => <Field label={signature} key={signature}><input value={formValues[`${selectedForm.id}:signature:${index}`] || ''} onChange={event => setFormValues(previous => ({ ...previous, [`${selectedForm.id}:signature:${index}`]: event.target.value }))} placeholder="Име и длъжност" /></Field>)}</div><SourceLinks ids={selectedForm.sourceIds} /><div className="form-actions"><button className="button primary" onClick={() => print('form', selectedForm.id)}><Printer size={16} /> Печат / запази PDF</button><button className="button secondary" onClick={() => setFormId(null)}>Затвори</button></div></Modal>}

    {selectedTraining && <Modal title={selectedTraining.title} wide onClose={() => { if (!saving) setTrainingId(null); }}><p className="eyebrow">{selectedTraining.id} · {selectedTraining.durationMinutes} мин · {selectedTraining.audience}</p><div className="prose"><h3>Какво ще можете да правите</h3><p>{selectedTraining.outcome}</p>{selectedTraining.documentIds.map(id => content.documents.find(document => document.id === id)).filter(Boolean).map(document => document && <Details title={document.title} key={document.id} open>{document.sections.map(part => <section key={part.title}><h4>{part.title}</h4><p>{part.body}</p></section>)}</Details>)}<h3>Практически стъпки</h3><ol>{selectedTraining.steps.map(step => <li key={step}>{step}</li>)}</ol><div className="notice"><strong>Упражнение:</strong> {selectedTraining.exercise}</div><h3>Проверка на разбирането</h3><p className="muted">Изберете по един отговор. За записване на преминаването са необходими {currentQuestions.length} верни отговора.</p></div><div className="checklist">{currentQuestions.map((question, index) => <fieldset className="quiz-question" key={question.question}><legend>{index + 1}. {question.question}</legend>{question.options.map((option, optionIndex) => <label className="quiz-option" key={option}><input type="radio" name={`${selectedTraining.id}-q-${index}`} checked={answers[index] === optionIndex} onChange={() => { setAnswers(previous => ({ ...previous, [index]: optionIndex })); setChecked(false); }} disabled={saving} /><span>{option}</span></label>)}{checked && <p className={answers[index] === question.correct ? 'quiz-correct' : 'quiz-incorrect'}>{answers[index] === question.correct ? 'Верен отговор. ' : 'Прегледайте отговора. '}{question.explanation}</p>}</fieldset>)}</div>{checked && <p className="notice" role="status">{passed ? `Успешна самопроверка: ${correctCount} от ${currentQuestions.length} верни отговора.` : `Резултат: ${correctCount} от ${currentQuestions.length}. Прегледайте поясненията и опитайте отново.`}</p>}<div className="form-actions"><button className="button secondary" onClick={checkAnswers} disabled={saving}>Провери отговорите</button>{completeIds.has(selectedTraining.id) ? <span className="badge"><Check size={15} /> Преминаването е записано</span> : <button className="button primary" disabled={!passed || saving} onClick={saveCompletion}>{saving ? 'Записване…' : 'Запиши преминаването'}</button>}</div><p className="muted">Самопроверката подпомага обучението. Практическата подготовка и приемането на служител за оперативна работа се документират от отговорната организация.</p></Modal>}

    {printRequest && typeof document !== 'undefined' && createPortal(
      <div id="riverguard-print" className="print-only">
        <header className="print-header">
          <strong>RiverGuard България</strong>
          <p>Система за речен мониторинг</p>
        </header>
        {printedDocument && <>
          <h1>{printedDocument.title}</h1>
          <p>{printedDocument.id} · версия {printedDocument.version} · {printedDocument.status}</p>
          {printedDocument.sections.map(part => <section className="print-section" key={part.title}>
            <h2>{part.title}</h2>
            <p>{part.body}</p>
          </section>)}
          {printedDocument.sourceIds.length > 0 && <section className="print-section">
            <h2>Източници</h2>
            {content.sources.filter(source => printedDocument.sourceIds.includes(source.id)).map(source => <p key={source.id}>
              {source.title}<br />{source.url}
            </p>)}
          </section>}
        </>}
        {printedForm && <>
          <h1>{printedForm.title}</h1>
          <p>{printedForm.id} · работен образец · версия 1.0</p>
          <p>{printedForm.notice}</p>
          {printedForm.sections.map((part, sectionIndex) => <section className="print-section" key={part.title}>
            <h2>{part.title}</h2>
            <table className="print-fields"><tbody>
              {part.fields.map((field, fieldIndex) => <tr key={field}>
                <th scope="row">{field}</th>
                <td>{printRequest.blank ? ' ' : formValues[formKey(printedForm.id, sectionIndex, fieldIndex)] || ' '}</td>
              </tr>)}
            </tbody></table>
          </section>)}
          <section className="print-section">
            <h2>Лица и подписи</h2>
            <table className="print-fields"><tbody>
              {printedForm.signatures.map((signature, index) => <tr key={signature}>
                <th scope="row">{signature}</th>
                <td>{printRequest.blank ? ' ' : formValues[`${printedForm.id}:signature:${index}`] || ' '}<br /><span>Подпис: ____________________</span></td>
              </tr>)}
            </tbody></table>
          </section>
        </>}
      </div>, document.body
    )}
  </>;
}
