// ประกอบระบบ: store + services ผูกกับผู้ใช้ที่เข้าระบบ (ctx) · หน้าเว็บและ test เรียกผ่านทางเดียวกันนี้
import { TABLES } from './core/schema.js';
import { loadSettings } from './core/settings.js';
import { requirePermission } from './core/roles.js';
import { createStore } from './data/store.js';
import { FLOWS } from './core/flows.js';
import * as review from './services/review.js';
import * as approvals from './services/approvals.js';
import * as loans from './services/loans.js';
import * as procurement from './services/procurement.js';
import * as payments from './services/payments.js';
import * as documents from './services/documents.js';
import * as cheques from './services/cheques.js';
import * as ktb from './services/ktb.js';
import * as ledger from './services/ledger.js';
import * as receipts from './services/receipts.js';
import * as users from './services/users.js';
import * as settingsSvc from './services/settings.js';
import * as payees from './services/payees.js';
import { masterService, MASTER_TABLES } from './services/masters.js';

const SYSTEM_USER = { id: 'system', email: 'system', roles: [] };

export function createApp({ repo, clock, extraTables = {}, extraFlows = {} }) {
  const tables = { ...TABLES, ...extraTables };
  const flows = { ...FLOWS, ...documents.DOC_FLOWS, ...extraFlows };
  let store;
  const getSettings = () => loadSettings(store);
  store = createStore(repo, { clock, tables, getSettings });

  function makeCtx(user) {
    return {
      store, user, clock, flows,
      get settings() { return getSettings(); },
      today: () => store.today(),
    };
  }

  function bind(ctx) {
    const b = (fn) => (...args) => fn(ctx, ...args);
    const api = {
      ctx,
      users: { create: b(users.createUser), update: b(users.updateUser), list: b(users.listUsers) },
      settings: { update: b(settingsSvc.updateSetting), list: b(settingsSvc.listSettings), pending: b(settingsSvc.pendingSettings) },
      payees: {
        create: b(payees.createPayee), update: b(payees.updatePayee),
        list: b(payees.listPayees), get: b(payees.getPayee),
        requestAccountChange: b(payees.requestAccountChange),
        approveAccountChange: b(payees.approveAccountChange),
        rejectAccountChange: b(payees.rejectAccountChange),
        listAccountChanges: b(payees.listAccountChanges),
      },
      approvals: {
        submit: b(approvals.submit), resubmit: b(approvals.resubmit), receive: b(approvals.receive), returnToRequester: b(approvals.returnToRequester),
        propose: b(approvals.propose), recordDecision: b(approvals.recordDecision), financeReceive: b(approvals.financeReceive), classify: b(approvals.classify),
        list: b(approvals.list), get: b(approvals.get), closeCode: b(approvals.closeCode),
      },
      loans: { create: b(loans.createLoan), list: b((c) => { requirePermission(c, 'masters.read'); return loans.listLoans(c); }) },
      procurement: {
        purchase: b(procurement.purchase), inspect: b(procurement.inspect), sendBundle: b(procurement.sendBundle), receiveBundle: b(procurement.receiveBundle),
        list: b((c) => { requirePermission(c, 'masters.read'); return procurement.listProcurements(c); }),
      },
      payments: { createLine: b(payments.createLine), updateLine: b(payments.updateLine), reverseLine: b(payments.reverseLine), listLines: b(payments.listLines) },
      khb: { create: b(documents.createKhb), list: b((c) => { requirePermission(c, 'masters.read'); return documents.listKhb(c); }) },
      khj: { generate: b(documents.generateKhj), list: b((c) => { requirePermission(c, 'masters.read'); return documents.listKhj(c); }) },
      cheques: {
        propose: b(cheques.propose), confirm: b(cheques.confirm), voidCheque: b(cheques.voidCheque), register: b((c, a) => { requirePermission(c, 'masters.read'); return cheques.register(c, a); }),
        sendForSignature: b(cheques.sendForSignature), markReceived: b(cheques.markReceived), list: b((c) => { requirePermission(c, 'masters.read'); return cheques.listCheques(c); }),
      },
      ktb: { createBatch: b(ktb.createBatch), fileContent: b(ktb.fileContent), markUploaded: b(ktb.markUploaded), recordApproval: b(ktb.recordApproval), recordTxn: b(ktb.recordTxn), approvers: b(ktb.approvers), list: b((c) => { requirePermission(c, 'masters.read'); return ktb.listBatches(c); }) },
      packages: { create: b(receipts.createPackage), list: b(receipts.listPackages) },
      collectibles: { set: b(receipts.setCollectible), list: b(receipts.listCollectibles) },
      receipts: {
        issue: b(receipts.issue), preview: b(receipts.preview), cancel: b(receipts.cancel), nextNo: b((c, book) => { requirePermission(c, 'masters.read'); return receipts.nextNo(c, book); }),
        list: b(receipts.listReceipts), splits: b(receipts.splitsOf), monthlySummary: b(receipts.monthlySummary),
      },
      ledger: { list: b(ledger.listLedger), balance: b(ledger.balance), taxSummary: b(ledger.taxSummary) },
      workflow: {
        submit: b(review.submitForReview), receive: b(review.receiveStage), pass: b(review.passStage), returnDoc: b(review.returnStage),
        receiveSigned: b(review.receiveSigned), directorReturn: b(review.directorReturn),
        status: b(review.statusOf), inbox: b(review.inbox),
        overdue: () => { requirePermission(ctx, 'flags.read'); return review.overdue(ctx); },
      },
      audit: {
        list: () => { requirePermission(ctx, 'audit.read'); return store.list('audit_log'); },
        logins: () => { requirePermission(ctx, 'audit.read'); return store.list('login_log'); },
      },
    };
    for (const t of MASTER_TABLES) {
      const s = masterService(t);
      api[t] = { create: b(s.create), update: b(s.update), list: b(s.list), get: b(s.get) };
      if (t === 'subfunds') api[t].seedDefaults = b(receipts.seedDefaultSubfunds);
    }
    return api;
  }

  return {
    store,
    tables,
    /** ตั้งระบบครั้งแรก: ใส่ค่าตั้งเริ่มต้น + ผู้ดูแลระบบคนแรก */
    bootstrap(input) {
      const ctx = makeCtx({ ...SYSTEM_USER, email: 'system:bootstrap' });
      if (store.list('users').length) users.bootstrapAdmin(ctx, input); // โยน error "มีผู้ใช้แล้ว"
      settingsSvc.seedSettings(ctx);
      return users.bootstrapAdmin(ctx, input);
    },
    /** ค่าตั้งปัจจุบัน สำหรับขั้นล็อกอิน (ก่อนรู้ว่าเป็นใคร) */
    asSystemSettings: () => getSettings(),
    /** ทุกคำขอเริ่มที่นี่: อีเมลที่ Google ยืนยัน → ผู้ใช้ในระบบ */
    asUser(email) {
      return bind(makeCtx(users.resolveUser(store, email, getSettings())));
    },
  };
}
