// Sample household for demo mode (?demo=1). Nothing is saved.
import { DEFAULT_CATEGORIES } from './categorize.js';
import { isoDate, round2 } from './util.js';

export function demoTables(today = new Date()) {
  const budgets = { Housing: 1600, Groceries: 650, Dining: 250, Transport: 220, Utilities: 260, Subscriptions: 60, Shopping: 200, Health: 80, Entertainment: 80 };
  const Categories = DEFAULT_CATEGORIES.map(([name, kind], i) => ({ id: `cat-${i}`, name, kind, monthly_budget: budgets[name] || 0, sort: i, archived: false, updated_at: '', deleted: false }));
  const cat = (n) => Categories.find((c) => c.name === n).id;
  const Accounts = [
    { id: 'acct-1', name: 'Joint checking', type: 'checking', balance: 3240.12, deleted: false },
    { id: 'acct-2', name: 'Rewards card', type: 'credit', balance: 612.4, deleted: false, available_mode: 'full' },
    { id: 'acct-3', name: 'High-yield savings', type: 'savings', balance: 6150, rate: 4.1, deleted: false, available_mode: 'none' },
    { id: 'acct-4', name: 'Car loan ··4821', type: 'car_loan', balance: 14320, rate: 6.4, payment: 447.18, deleted: false, available_mode: 'payment' },
    { id: 'acct-5', name: 'Mortgage', type: 'mortgage', balance: 286400, rate: 5.9, payment: 1950, deleted: false, available_mode: 'payment' },
  ];
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const people = ['you@example.com', 'partner@example.com'];
  const Transactions = [];
  const add = (d, description, amount, type, category) => {
    if (d > today) return;
    Transactions.push({ id: `t-${Transactions.length}`, date: isoDate(d), description, amount: round2(amount), type, category_id: category ? cat(category) : '', account_id: type === 'income' || category === 'Housing' ? 'acct-1' : 'acct-2', note: '', entered_by: people[Transactions.length % 2], import_id: 'demo', external_id: '', updated_at: '', deleted: false });
  };
  for (let k = 3; k >= 0; k--) {
    const y = today.getFullYear(), m = today.getMonth() - k;
    const day = (n) => new Date(y, m, n);
    add(day(1), 'RENT PAYMENT OAKWOOD APARTMENTS', -1600, 'expense', 'Housing');
    add(day(1), 'ACME INC PAYROLL DIR DEP', 2950, 'income', 'Paycheck');
    add(day(15), 'ACME INC PAYROLL DIR DEP', 2950, 'income', 'Paycheck');
    add(day(5), 'NETFLIX.COM', -15.49, 'expense', 'Subscriptions');
    add(day(9), 'SPOTIFY USA', -11.99, 'expense', 'Subscriptions');
    add(day(12), 'ROCKY MOUNTAIN POWER', -(110 + rnd() * 50), 'expense', 'Utilities');
    add(day(18), 'XFINITY INTERNET', -80, 'expense', 'Utilities');
    add(day(20), 'ONLINE PAYMENT THANK YOU', -600, 'transfer', null);
    for (let w = 0; w < 4; w++) {
      add(day(3 + w * 7), 'SMITHS FOOD #4401', -(95 + rnd() * 70), 'expense', 'Groceries');
      add(day(4 + w * 7), 'MAVERIK #322', -(38 + rnd() * 20), 'expense', 'Transport');
      add(day(6 + w * 7), 'CHIPOTLE 2231', -(18 + rnd() * 30), 'expense', 'Dining');
      if (rnd() > 0.5) add(day(2 + w * 7), 'AMAZON MKTPL*2K1', -(20 + rnd() * 60), 'expense', 'Shopping');
      if (rnd() > 0.6) add(day(5 + w * 7), 'STARBUCKS #1234', -(5 + rnd() * 4), 'expense', 'Dining');
    }
    if (k === 0) add(day(10), 'MYSTERY SHOP LLC', -24, 'expense', null);
  }
  const sub = (id, name, amount, frequency, day, cat) => ({ id, name, amount, frequency, next_date: isoDate(new Date(today.getFullYear(), today.getMonth(), day)), category_id: cat ? Categories.find((c) => c.name === cat).id : '', account_id: 'acct-2', note: '', deleted: false });
  const Subscriptions = [sub('s1', 'Netflix', 15.49, 'monthly', 5, 'Subscriptions'), sub('s2', 'Spotify', 11.99, 'monthly', 9, 'Subscriptions'),
    sub('s3', 'Xfinity internet', 80, 'monthly', 18, 'Utilities'), sub('s4', 'Amazon Prime', 139, 'yearly', today.getDate() + 12, 'Shopping'), sub('s5', 'Gym', 24.99, 'monthly', today.getDate() + 2, 'Health')];
  const Goals = [
    { id: 'g1', name: 'Emergency fund', target: 9000, target_date: isoDate(new Date(today.getFullYear() + 1, 5, 30)), account_id: 'acct-3', monthly: 250, color: 0, sort: 0, done: false, deleted: false },
    { id: 'g2', name: 'Summer trip', target: 2500, target_date: isoDate(new Date(today.getFullYear() + 1, 4, 15)), account_id: 'acct-3', monthly: 0, monthly_pct: 4, color: 2, sort: 1, done: false, deleted: false },
    { id: 'g3', name: 'New tires', target: 900, target_date: '', account_id: 'acct-3', monthly: 100, color: 3, sort: 2, done: false, deleted: false },
  ];
  const ge = (id, goal, months, amount, note) => ({ id, goal_id: goal, date: isoDate(new Date(today.getFullYear(), today.getMonth() - months, 3)), amount, note, deleted: false });
  const GoalEntries = [ge('e1', 'g1', 6, 4000, 'Starting amount'), ge('e2', 'g1', 1, 250, ''), ge('e3', 'g2', 3, 900, 'Starting amount'), ge('e4', 'g2', 0, 150, 'October'), ge('e5', 'g3', 0, 350, '')];
  return { Categories, Accounts, Transactions, Rules: [], Settings: [], Subscriptions, Goals, GoalEntries };
}
