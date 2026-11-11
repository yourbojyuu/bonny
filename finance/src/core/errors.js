// error ที่ชี้ช่องที่ผิด เพื่อให้หน้าเว็บแสดงข้างช่องได้
export class ValidationError extends Error {
  constructor(errors) {
    super(errors.map((e) => `${e.field}: ${e.message}`).join(' · '));
    this.name = 'ValidationError';
    this.errors = errors;
  }
}

export class PermissionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PermissionError';
  }
}

/** สะสม error หลายช่องแล้วโยนครั้งเดียว */
export function collector() {
  const errors = [];
  return {
    add(field, message) { errors.push({ field, message }); },
    has(field) { return errors.some((e) => e.field === field); },
    throwIfAny() { if (errors.length) throw new ValidationError(errors); },
    get errors() { return errors; },
  };
}

export function fail(field, message) {
  throw new ValidationError([{ field, message }]);
}
