import React, { useState, useEffect, useMemo } from 'react';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, 
  ResponsiveContainer, BarChart, Bar, Cell
} from 'recharts';

// ==========================================
// КОНФИГУРАЦИЯ
// ==========================================
const GOOGLE_SHEETS_ID = '1oJtLLMd13oPqNGS2htIS7kS-CVGvr1vIQJXEXBVqd-4';
const SHEET_NAME = 'Цены (Актуальные)';
const SHEETS_URL = `https://docs.google.com/spreadsheets/d/${GOOGLE_SHEETS_ID}/edit`;

// Точные названия колонок из таблицы
const COLUMNS = {
  name: 'Наименование ЖК',
  developer: 'Застройщик',
  district: 'Район',
  class: 'Класс',
};

// Цвета
const CLASS_COLORS = {
  'Комфорт': '#3b82f6',
  'Бизнес': '#8b5cf6',
  'Премиум': '#f59e0b'
};

const DISTRICT_COLORS = {
  'Мирзо-Улугбекский': '#3b82f6',
  'Мирабадский': '#8b5cf6',
  'Яшнабадский': '#10b981',
  'Алмазарский': '#f59e0b',
  'Яккасарийский': '#ec4899'
};

// ==========================================
// МОДЕЛЬ TSK
// ==========================================
class FuzzyTSKModel {
  constructor() {
    this.rules = [
      { time: 'short', activity: 'high', consequent: 0.06 },
      { time: 'short', activity: 'medium', consequent: 0.03 },
      { time: 'short', activity: 'low', consequent: 0.01 },
      { time: 'medium', activity: 'high', consequent: 0.12 },
      { time: 'medium', activity: 'medium', consequent: 0.07 },
      { time: 'medium', activity: 'low', consequent: 0.03 },
      { time: 'long', activity: 'high', consequent: 0.20 },
      { time: 'long', activity: 'medium', consequent: 0.12 },
      { time: 'long', activity: 'low', consequent: 0.06 },
    ];
  }

  gaussian(x, center, sigma) {
    return Math.exp(-Math.pow((x - center) / sigma, 2));
  }

  getClassCoefficient(className) {
    const cls = (className || '').toLowerCase();
    if (cls.includes('премиум')) return 1.25;
    if (cls.includes('бизнес')) return 1.15;
    return 1.0;
  }

  predict(timeMonths, marketActivity, trend, className) {
    const timeParams = {
      short: { center: 6, sigma: 3 },
      medium: { center: 12, sigma: 4 },
      long: { center: 24, sigma: 6 }
    };
    
    const activityParams = {
      high: { center: 0.7, sigma: 0.2 },
      medium: { center: 0.5, sigma: 0.2 },
      low: { center: 0.3, sigma: 0.2 }
    };

    let totalWeight = 0;
    let weightedSum = 0;

    for (const rule of this.rules) {
      const wTime = this.gaussian(timeMonths, timeParams[rule.time].center, timeParams[rule.time].sigma);
      const wActivity = this.gaussian(marketActivity, activityParams[rule.activity].center, activityParams[rule.activity].sigma);
      const w = Math.min(wTime, wActivity);
      
      if (w > 0.01) {
        totalWeight += w;
        weightedSum += w * rule.consequent;
      }
    }

    let baseChange = totalWeight > 0 ? weightedSum / totalWeight : 0.05;
    baseChange += trend * 0.3;
    baseChange *= this.getClassCoefficient(className);

    return baseChange;
  }

  forecast(basePrice, className, trend, marketActivity = 0.5) {
    return [6, 12, 18, 24].map(months => {
      const change = this.predict(months, marketActivity, trend, className);
      return {
        months,
        price: Math.round(basePrice * (1 + change)),
        change: (change * 100).toFixed(1)
      };
    });
  }
}

// ==========================================
// ПАРСЕР GOOGLE SHEETS
// ==========================================
function getSheetUrl() {
  return `https://docs.google.com/spreadsheets/d/${GOOGLE_SHEETS_ID}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(SHEET_NAME)}`;
}

function parseGoogleSheetsResponse(text) {
  try {
    const match = text.match(/google\.visualization\.Query\.setResponse\(([\s\S]*)\);?$/);
    const jsonStr = match ? match[1] : text.substring(text.indexOf('{'), text.lastIndexOf('}') + 1);
    const data = JSON.parse(jsonStr);
    
    if (!data.table || !data.table.rows) {
      console.error('Неверный формат ответа:', data);
      return null;
    }
    
    const headers = data.table.cols.map(col => col.label || '');
    console.log('📊 Заголовки из таблицы:', headers);
    
    const rows = data.table.rows.map(row => {
      const obj = {};
      if (row.c) {
        row.c.forEach((cell, i) => {
          obj[headers[i]] = cell ? (cell.v !== null ? cell.v : '') : '';
        });
      }
      return obj;
    }).filter(row => row[COLUMNS.name]);
    
    console.log('📊 Загружено строк:', rows.length);
    
    return { headers, rows };
  } catch (e) {
    console.error('Ошибка парсинга:', e);
    return null;
  }
}

// ==========================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ==========================================
function normalizeClass(cls) {
  if (!cls) return null;
  const lower = String(cls).toLowerCase().trim();
  
  // Строгая проверка - только точные совпадения
  if (lower === 'комфорт') return 'Комфорт';
  if (lower === 'бизнес') return 'Бизнес';
  if (lower === 'премиум') return 'Премиум';
  
  // Проверка с вхождением (для случаев вроде "комфорт, бизнес")
  if (lower.includes('премиум')) return 'Премиум';
  if (lower.includes('бизнес')) return 'Бизнес';
  if (lower.includes('комфорт')) return 'Комфорт';
  
  return null; // Неизвестный класс - пропускаем
}

function normalizeDistrict(d) {
  if (!d) return null;
  const lower = String(d).toLowerCase().trim();
  if (lower.includes('мирзо')) return 'Мирзо-Улугбекский';
  if (lower.includes('мирабад')) return 'Мирабадский';
  if (lower.includes('яшнабад')) return 'Яшнабадский';
  if (lower.includes('алмазар')) return 'Алмазарский';
  if (lower.includes('яккасар')) return 'Яккасарийский';
  return d;
}

function parsePrice(val) {
  if (val === null || val === undefined || val === '' || val === '-') return null;
  if (typeof val === 'number') return val;
  const num = parseFloat(String(val).replace(/[^\d.]/g, ''));
  return isNaN(num) ? null : num;
}

function findPriceColumns(headers) {
  return headers.filter(h => h && h.toLowerCase().startsWith('цена '));
}

// ==========================================
// СТИЛИ
// ==========================================
const styles = {
  container: {
    minHeight: '100vh',
    backgroundColor: '#1f2d1fff',
    color: '#e2e8f0',
    padding: '24px',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    margin: 0,
  },
  maxWidth: {
    maxWidth: '1400px',
    margin: '0 auto',
  },
  header: {
    background: 'linear-gradient(135deg, #1d5446ff 0%, #184c3bff 50%, #124533ff 100%)',
    borderRadius: '16px',
    padding: '24px',
    marginBottom: '24px',
  },
  title: {
    fontSize: '28px',
    fontWeight: 'bold',
    color: 'white',
    marginBottom: '8px',
  },
  subtitle: {
    color: '#c7d2fe',
    fontSize: '14px',
  },
  card: {
    backgroundColor: 'rgba(33, 132, 105, 0.3)',
    borderRadius: '12px',
    padding: '20px',
    marginBottom: '20px',
    border: '1px solid rgba(16, 185, 129, 0.2)',
  },
  cardTitle: {
    fontSize: '18px',
    fontWeight: '600',
    marginBottom: '16px',
    color: '#6ee7b7',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
    gap: '20px',
    marginBottom: '24px',
  },
  metricCard: {
    backgroundColor: 'rgba(33, 123, 99, 0.4)',
    borderRadius: '12px',
    padding: '20px',
    border: '1px solid rgba(16, 185, 129, 0.2)',
  },
  metricLabel: {
    fontSize: '14px',
    color: '#519278ff',
    marginBottom: '4px',
  },
  metricValue: {
    fontSize: '28px',
    fontWeight: 'bold',
    color: '#f1f5f9',
  },
  metricSub: {
    fontSize: '13px',
    color: '#64748b',
    marginTop: '4px',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '14px',
  },
  th: {
    padding: '12px',
    textAlign: 'left',
    borderBottom: '1px solid rgba(255,255,255,0.1)',
    color: '#94a3b8',
    fontWeight: '600',
  },
  td: {
    padding: '12px',
    borderBottom: '1px solid rgba(255,255,255,0.05)',
    color: '#e2e8f0',
  },
  badge: {
    display: 'inline-block',
    padding: '4px 10px',
    borderRadius: '12px',
    fontSize: '12px',
    fontWeight: '600',
  },
  button: {
    background: 'rgba(4, 18, 14, 0.15)',
    border: '1px solid rgba(16, 185, 129, 0.4)',
    borderRadius: '8px',
    padding: '10px 20px',
    color: 'white',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '500',
    textDecoration: 'none',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
  },
  buttonSecondary: {
    background: 'rgba(4, 18, 14, 0.15)',
    border: '1px solid rgba(16, 185, 129, 0.4)',
    borderRadius: '8px',
    padding: '10px 20px',
    color: '#ffffffff',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '500',
    textDecoration: 'none',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
  },
  loading: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '300px',
    gap: '16px',
  },
  error: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    border: '1px solid rgba(239, 68, 68, 0.3)',
    borderRadius: '12px',
    padding: '20px',
    color: '#fca5a5',
  },
  tabs: {
    display: 'flex',
    gap: '8px',
    marginBottom: '20px',
    flexWrap: 'wrap',
  },
  tab: {
    padding: '10px 20px',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '500',
    border: 'none',
  },
  tabActive: {
    background: 'linear-gradient(135deg, #059669, #10b981)',
    color: 'white',
  },
  tabInactive: {
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    color: '#6ee7b7',
  },
  buttonGroup: {
    display: 'flex',
    gap: '12px',
    flexWrap: 'wrap',
  },
};

// ==========================================
// ГЛАВНЫЙ КОМПОНЕНТ
// ==========================================
export default function TashkentForecastApp() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [lastUpdate, setLastUpdate] = useState(null);

  const model = useMemo(() => new FuzzyTSKModel(), []);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    
    try {
      console.log('🔄 Загрузка данных...');
      
      const response = await fetch(getSheetUrl());
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      
      const text = await response.text();
      const parsed = parseGoogleSheetsResponse(text);
      if (!parsed) throw new Error('Не удалось распарсить данные');
      
      setData(parsed);
      setLastUpdate(new Date().toLocaleString('ru-RU'));
      console.log('✅ Данные загружены!');
      
    } catch (err) {
      console.error('❌ Ошибка:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const analysis = useMemo(() => {
    if (!data) return null;
    
    const { headers, rows } = data;
    const priceColumns = findPriceColumns(headers);
    
    console.log('🔍 Колонки с ценами:', priceColumns);
    
    if (priceColumns.length === 0) {
      console.error('❌ Не найдены колонки с ценами!');
      return null;
    }

    const byClass = {};
    const byDistrict = {};
    const allJK = [];

    rows.forEach((row, i) => {
      const name = row[COLUMNS.name];
      const classRaw = row[COLUMNS.class];
      const districtRaw = row[COLUMNS.district];
      
      if (!name) return;
      
      const cls = normalizeClass(classRaw);
      if (!cls) {
        console.log(`⚠️ Пропущен ${name}: неизвестный класс "${classRaw}"`);
        return;
      }
      
      const district = normalizeDistrict(districtRaw);
      
      const prices = priceColumns
        .map(col => ({ col, price: parsePrice(row[col]) }))
        .filter(p => p.price !== null && p.price > 0);
      
      if (prices.length === 0) return;
      
      const firstPrice = prices[0].price;
      const lastPrice = prices[prices.length - 1].price;
      const trend = prices.length > 1 ? (lastPrice - firstPrice) / firstPrice : 0;
      
      // Логируем все ЖК
      console.log(`📋 ${name}: класс="${classRaw}" -> ${cls}, цена=${lastPrice}`);

      const jk = {
        name,
        class: cls,
        district,
        prices: prices.map(p => p.price),
        priceLabels: prices.map(p => p.col.replace('Цена ', '')),
        firstPrice,
        lastPrice,
        trend,
        trendPercent: (trend * 100).toFixed(1)
      };
      
      allJK.push(jk);

      if (!byClass[cls]) byClass[cls] = [];
      byClass[cls].push(jk);

      if (district) {
        if (!byDistrict[district]) byDistrict[district] = [];
        byDistrict[district].push(jk);
      }
    });

    // Логируем количество по классам
    console.log('📊 Итого по классам:');
    Object.entries(byClass).forEach(([cls, jks]) => {
      console.log(`   ${cls}: ${jks.length} ЖК ->`, jks.map(j => j.name));
    });

    const classStats = {};
    Object.entries(byClass).forEach(([cls, jks]) => {
      const lastPrices = jks.map(j => j.lastPrice);
      const avg = Math.round(lastPrices.reduce((a, b) => a + b, 0) / lastPrices.length);
      const min = Math.min(...lastPrices);
      const max = Math.max(...lastPrices);
      const avgTrend = jks.reduce((a, j) => a + j.trend, 0) / jks.length;
      
      classStats[cls] = { count: jks.length, avg, min, max, avgTrend, jks };
    });

    const districtStats = {};
    Object.entries(byDistrict).forEach(([d, jks]) => {
      const lastPrices = jks.map(j => j.lastPrice);
      const avg = Math.round(lastPrices.reduce((a, b) => a + b, 0) / lastPrices.length);
      districtStats[d] = { count: jks.length, avg, jks };
    });

    const priceHistory = priceColumns.map(col => {
      const month = col.replace('Цена ', '');
      const point = { month };
      
      Object.keys(byClass).forEach(cls => {
        const prices = byClass[cls]
          .map(jk => parsePrice(rows.find(r => r[COLUMNS.name] === jk.name)?.[col]))
          .filter(p => p !== null && p > 0);
        
        if (prices.length > 0) {
          point[cls] = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
        }
      });
      
      return point;
    });

    return { classStats, districtStats, allJK, priceColumns, priceHistory };
  }, [data]);

  const forecasts = useMemo(() => {
    if (!analysis) return null;
    
    const byClass = {};
    Object.entries(analysis.classStats).forEach(([cls, stats]) => {
      const forecast = model.forecast(stats.avg, cls, stats.avgTrend);
      byClass[cls] = {
        current: stats.avg,
        count: stats.count,
        trend: stats.avgTrend,
        forecast
      };
    });

    return byClass;
  }, [analysis, model]);

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.maxWidth}>
          <div style={styles.header}>
            <h1 style={styles.title}>Прогноз цен на новостройки Ташкента</h1>
          </div>
          <div style={styles.loading}>
            <div style={{ fontSize: '40px' }}>⏳</div>
            <p>Загрузка данных из Google Sheets...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error || !analysis) {
    return (
      <div style={styles.container}>
        <div style={styles.maxWidth}>
          <div style={styles.header}>
            <h1 style={styles.title}>Прогноз цен на новостройки Ташкента</h1>
          </div>
          <div style={styles.error}>
            <h3>❌ Ошибка загрузки</h3>
            <p>{error || 'Не удалось проанализировать данные'}</p>
            <div style={{ ...styles.buttonGroup, marginTop: '16px' }}>
              <button onClick={loadData} style={styles.button}>
                🔄 Попробовать снова
              </button>
              <a href={SHEETS_URL} target="_blank" rel="noopener noreferrer" style={styles.buttonSecondary}>
                Открыть исходную таблицу
              </a>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const tabs = [
    { id: 'overview', label: 'Обзор' },
    { id: 'forecast', label: 'Прогноз' },
    { id: 'details', label: 'Все ЖК' },
  ];

  return (
    <div style={styles.container}>
      <div style={styles.maxWidth}>
        {/* Header */}
        <div style={styles.header}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
            <div>
              <h1 style={styles.title}>Прогноз цен на новостройки Ташкента</h1>
              <p style={styles.subtitle}>
                Общее количество ЖК: {analysis.allJK.length} • Обновлено: {lastUpdate}
              </p>
            </div>
            <div style={styles.buttonGroup}>
              <button onClick={loadData} style={styles.button}>
                Обновить данные
              </button>
              <a href={SHEETS_URL} target="_blank" rel="noopener noreferrer" style={styles.buttonSecondary}>
                Открыть исходную таблицу
              </a>
            </div>
          </div>
        </div>

        {/* Метрики по классам */}
        <div style={styles.grid}>
          {Object.entries(analysis.classStats).map(([cls, stats]) => {
            const forecast = forecasts?.[cls];
            const f24 = forecast?.forecast.find(f => f.months === 24);
            
            return (
              <div key={cls} style={{ ...styles.metricCard, borderLeft: `4px solid ${CLASS_COLORS[cls] || '#6b7280'}` }}>
                <div style={styles.metricLabel}>{cls}</div>
                <div style={styles.metricValue}>${stats.avg.toLocaleString()}</div>
                <div style={styles.metricSub}>
                  {stats.count} ЖК • ${stats.min.toLocaleString()} – ${stats.max.toLocaleString()}
                </div>
                <div style={{ marginTop: '8px', color: stats.avgTrend >= 0 ? '#4ade80' : '#f87171' }}>
                  Тренд: {stats.avgTrend >= 0 ? '+' : ''}{(stats.avgTrend * 100).toFixed(1)}%
                  {f24 && <span style={{ marginLeft: '12px' }}>• Прогноз 24м: +{f24.change}%</span>}
                </div>
              </div>
            );
          })}
        </div>

        {/* Tabs */}
        <div style={styles.tabs}>
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{ ...styles.tab, ...(activeTab === tab.id ? styles.tabActive : styles.tabInactive) }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Overview Tab */}
        {activeTab === 'overview' && (
          <>
            <div style={styles.card}>
              <h2 style={styles.cardTitle}>Динамика цен по классам</h2>
              <div style={{ height: '350px' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={analysis.priceHistory}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                    <XAxis dataKey="month" stroke="#94a3b8" />
                    <YAxis stroke="#94a3b8" tickFormatter={v => `$${v}`} />
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#052e16', border: '1px solid #166534' }}
                      formatter={(v) => [`$${v?.toLocaleString()}`, '']}
                    />
                    <Legend />
                    {Object.keys(analysis.classStats).map(cls => (
                      <Line 
                        key={cls}
                        type="monotone"
                        dataKey={cls}
                        stroke={CLASS_COLORS[cls] || '#6b7280'}
                        strokeWidth={3}
                        dot={{ r: 5 }}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div style={styles.card}>
              <h2 style={styles.cardTitle}>Средние цены по районам</h2>
              <div style={{ height: '300px' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart 
                    data={Object.entries(analysis.districtStats).map(([d, s]) => ({ district: d, price: s.avg, count: s.count }))}
                    layout="vertical"
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                    <XAxis type="number" stroke="#94a3b8" tickFormatter={v => `$${v}`} />
                    <YAxis dataKey="district" type="category" width={140} stroke="#94a3b8" tick={{ fontSize: 12 }} />
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#052e16', border: '1px solid #166534' }}
                      formatter={(v) => [`$${v?.toLocaleString()}`, 'Цена']}
                    />
                    <Bar dataKey="price" radius={[0, 4, 4, 0]}>
                      {Object.keys(analysis.districtStats).map((d, i) => (
                        <Cell key={i} fill={DISTRICT_COLORS[d] || '#6b7280'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </>
        )}

        {/* Forecast Tab */}
        {activeTab === 'forecast' && forecasts && (
          <div style={styles.card}>
            <h2 style={styles.cardTitle}>Прогноз на 24 месяца</h2>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Класс</th>
                  <th style={styles.th}>Сейчас</th>
                  <th style={styles.th}>Тренд</th>
                  <th style={styles.th}>+6 мес</th>
                  <th style={styles.th}>+12 мес</th>
                  <th style={styles.th}>+18 мес</th>
                  <th style={styles.th}>+24 мес</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(forecasts).map(([cls, data]) => (
                  <tr key={cls}>
                    <td style={styles.td}>
                      <span style={{ ...styles.badge, backgroundColor: `${CLASS_COLORS[cls]}30`, color: CLASS_COLORS[cls] }}>
                        {cls}
                      </span>
                    </td>
                    <td style={{ ...styles.td, fontWeight: '600' }}>${data.current.toLocaleString()}</td>
                    <td style={{ ...styles.td, color: data.trend >= 0 ? '#4ade80' : '#f87171' }}>
                      {data.trend >= 0 ? '+' : ''}{(data.trend * 100).toFixed(1)}%
                    </td>
                    {data.forecast.map((f, i) => (
                      <td key={i} style={styles.td}>
                        ${f.price.toLocaleString()}
                        <span style={{ color: '#4ade80', marginLeft: '6px', fontSize: '12px' }}>+{f.change}%</span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Details Tab */}
        {activeTab === 'details' && (
          <div style={styles.card}>
            <h2 style={styles.cardTitle}>Все ЖК ({analysis.allJK.length})</h2>
            <div style={{ overflowX: 'auto', maxHeight: '500px' }}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>ЖК</th>
                    <th style={styles.th}>Класс</th>
                    <th style={styles.th}>Район</th>
                    {analysis.priceColumns.map(col => (
                      <th key={col} style={styles.th}>{col.replace('Цена ', '')}</th>
                    ))}
                    <th style={styles.th}>Тренд</th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.allJK.map((jk, i) => (
                    <tr key={i}>
                      <td style={{ ...styles.td, fontWeight: '500' }}>{jk.name}</td>
                      <td style={styles.td}>
                        <span style={{ ...styles.badge, backgroundColor: `${CLASS_COLORS[jk.class]}30`, color: CLASS_COLORS[jk.class] }}>
                          {jk.class}
                        </span>
                      </td>
                      <td style={styles.td}>{jk.district || '—'}</td>
                      {jk.prices.map((p, j) => (
                        <td key={j} style={styles.td}>${p.toLocaleString()}</td>
                      ))}
                      {Array(analysis.priceColumns.length - jk.prices.length).fill(0).map((_, j) => (
                        <td key={`empty-${j}`} style={styles.td}>—</td>
                      ))}
                      <td style={{ ...styles.td, color: jk.trend >= 0 ? '#4ade80' : '#f87171' }}>
                        {jk.prices.length > 1 ? `${jk.trend >= 0 ? '+' : ''}${jk.trendPercent}%` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Footer */}
        <div style={{ marginTop: '40px', textAlign: 'center', color: '#64748b', fontSize: '13px' }}>
          <p>Модель: Нечёткая нейронная сеть TSK • Источник: Google Sheets</p>
        </div>
      </div>
    </div>
  );
}
