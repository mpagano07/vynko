const SKU_REGEX = /^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/;

export type ProductValidationErrors = Partial<{
  name: string;
  sku: string;
  price: string;
  stock: string;
}>;

export function validateProductName(name: unknown): string | null {
  if (typeof name !== 'string' || !name.trim()) {
    return 'El nombre del producto es requerido';
  }
  return null;
}

export function validateSku(sku: unknown): string | null {
  if (sku === undefined || sku === null || sku === '') return null;

  if (typeof sku !== 'string') {
    return 'El SKU debe ser un texto';
  }
  const trimmed = sku.trim();
  if (trimmed.length < 3) {
    return 'El SKU debe tener al menos 3 caracteres';
  }
  if (trimmed.length > 64) {
    return 'El SKU no puede superar los 64 caracteres';
  }
  if (!SKU_REGEX.test(trimmed)) {
    return 'El SKU solo puede contener letras, números y los símbolos . _ -';
  }
  return null;
}

export function validatePrice(price: unknown): string | null {
  if (price === undefined || price === null || price === '') return null;

  const num = Number(price);
  if (Number.isNaN(num)) {
    return 'El precio debe ser un número';
  }
  if (num < 0) {
    return 'El precio no puede ser negativo';
  }
  return null;
}

export function validateStock(stock: unknown): string | null {
  if (stock === undefined || stock === null || stock === '') return null;

  const num = Number(stock);
  if (Number.isNaN(num) || !Number.isInteger(num)) {
    return 'El stock debe ser un número entero';
  }
  if (num < 0) {
    return 'El stock no puede ser negativo';
  }
  return null;
}

export function validateProduct(input: {
  name?: unknown;
  sku?: unknown;
  price?: unknown;
  stock?: unknown;
}): ProductValidationErrors {
  const errors: ProductValidationErrors = {};
  const name = validateProductName(input.name);
  if (name) errors.name = name;
  const sku = validateSku(input.sku);
  if (sku) errors.sku = sku;
  const price = validatePrice(input.price);
  if (price) errors.price = price;
  const stock = validateStock(input.stock);
  if (stock) errors.stock = stock;
  return errors;
}
