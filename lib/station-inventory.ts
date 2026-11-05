import catalogue from './sensors-content.json';
import type {Reading, Station} from './types';

export type StationEquipment = {
  id: string;
  name: string;
  category: string;
  manufacturer: string;
  purpose: string;
  parameters: string[];
  constraints: string[];
  productUrl?: string;
  support: boolean;
  known: boolean;
};

const purposes: Record<string, string> = {
  rls500: 'Следи водното ниво без контакт с водата. Основният канал служи за наблюдение на покачването и сравнение с праговете на станцията.',
  pls500: 'Измерва ниво чрез налягането във водата и отчита температурата ѝ. Различният принцип на измерване позволява независима съпоставка с радарния канал.',
  pluvio: 'Измерва валежа и помага да се проследи връзката между дъжда и покачването на реката. Представителността на площадката за водосбора се определя от специалист.',
  rq30: 'Измерва безконтактно повърхностната скорост и нивото. Изчисляването на дебит изисква заснето сечение и проверен модел за конкретния участък.',
  exo2: 'Многопараметрична сонда за наблюдение на качеството на водата. Конкретните показатели зависят от действително монтираните измервателни модули.',
};

const supportingEquipment: StationEquipment[] = [
  {
    id: 'solar', name: 'Автономно захранване', category: 'Захранване',
    manufacturer: 'Конкретният комплект се определя по проект',
    purpose: 'Соларен модул, акумулатор, регулатор и защити осигуряват захранването. Оразмеряването отчита консумацията, зимния режим и засенчването на мястото.',
    parameters: [], constraints: [], support: true, known: true,
  },
  {
    id: 'gauge', name: 'Водомерна рейка и репер', category: 'Ръчен контрол',
    manufacturer: 'Конкретният комплект се определя по проект',
    purpose: 'Позволява ръчна проверка на нивото спрямо документирана отправна нула. Отчетът изисква безопасен достъп и отделен запис от оператора.',
    parameters: ['ръчно отчетено водно ниво'], constraints: [], support: true, known: true,
  },
  {
    id: 'cabinet', name: 'Защитен шкаф и монтажен комплект', category: 'Защита и монтаж',
    manufacturer: 'Конкретният комплект се определя по проект',
    purpose: 'Предпазва регистратора, връзките и електрическите компоненти. Закрепването и защитите се определят за одобреното място на станцията.',
    parameters: [], constraints: [], support: true, known: true,
  },
];

const equipmentById = new Map<string, StationEquipment>([
  ...catalogue.products.map(product => [product.id, {
    id: product.id,
    name: product.name,
    category: product.category,
    manufacturer: product.manufacturer,
    purpose: purposes[product.id] || product.application,
    parameters: product.parameters,
    constraints: product.constraints,
    productUrl: product.productUrl,
    support: product.id === 'netdl',
    known: true,
  }] as [string, StationEquipment]),
  ...supportingEquipment.map(product => [product.id, product] as [string, StationEquipment]),
]);

export function stationEquipment(station: Pick<Station, 'sensors'>): StationEquipment[] {
  return [...new Set(station.sensors || [])].map(id => equipmentById.get(id) || {
    id, name: `Неописано оборудване · ${id}`, category: 'За уточняване', manufacturer: 'Не е въведен',
    purpose: 'Идентификаторът присъства в конфигурацията на станцията, но няма свързано каталожно описание. Моделът, предназначението и измервателните канали следва да се уточнят.',
    parameters: [], constraints: [], support: false, known: false,
  });
}

export type SensorChannel = {
  label: string;
  unit: string;
  value: number | null;
  quality: Reading['quality'];
};

const finiteOrNull = (value: number | null | undefined) => typeof value === 'number' && Number.isFinite(value) ? value : null;

// Това са каналите, които текущият интерфейс действително приема.
// Каталожните възможности не създават автоматично измервания в станцията.
export function sensorChannels(id: string, reading?: Reading): SensorChannel[] {
  const channel = (label: string, unit: string, value: number | null | undefined, quality = reading?.quality): SensorChannel => ({
    label, unit, value: finiteOrNull(value), quality: finiteOrNull(value) === null ? 'missing' : quality || 'missing',
  });
  if (id === 'rls500') return [channel('Водно ниво · основен канал', 'm', reading?.level)];
  if (id === 'pls500') return [
    channel('Водно ниво · контролен канал', 'm', reading?.levelBackup, reading?.levelBackupQuality),
    channel('Температура на водата', '°C', reading?.temperature),
  ];
  if (id === 'pluvio') return [channel('Натрупан валеж · 60 min', 'mm', reading?.rainPeriodMinutes === 60 ? reading.rain : null)];
  if (id === 'rq30') return [channel('Повърхностна скорост', 'm/s', reading?.velocity)];
  return [];
}

export function safeSourceUrl(value?: string): string | null {
  if (!value || /[\u0000-\u0020\u007f]/.test(value)) return null;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
