import { Op } from 'sequelize';

/**
 * Shared single-source-of-truth coupon validation service.
 * Used by:
 *  - POST /api/coupons/apply
 *  - POST /api/coupons/validate
 *  - POST /api/orders (createOrder)
 *  - POST /api/payments/create-order (createPaymentOrder)
 */
export async function validateCouponForOrder(models, { code, subtotal = 0, items = [], userId = null, transaction = null }) {
  if (!code || typeof code !== 'string' || !code.trim()) {
    return {
      valid: false,
      status: 400,
      reason: 'empty',
      message: 'Invalid coupon code. Please try again.'
    };
  }

  const cleanCode = code.trim().toUpperCase();
  const findOpts = { where: { code: cleanCode } };
  if (transaction) findOpts.transaction = transaction;

  const coupon = await models.Coupon.findOne(findOpts);

  // 1. Coupon existence
  if (!coupon) {
    return {
      valid: false,
      status: 404,
      reason: 'not_found',
      message: 'Invalid coupon code. Please try again.'
    };
  }

  // 2. Active / Inactive status (admin disabled)
  if (!coupon.is_active) {
    return {
      valid: false,
      status: 400,
      reason: 'disabled',
      message: 'This coupon has expired or is no longer available.'
    };
  }

  const now = new Date();

  // 3. Start date check
  if (coupon.start_date && new Date(coupon.start_date) > now) {
    return {
      valid: false,
      status: 400,
      reason: 'not_started',
      message: 'This coupon has expired or is no longer available.'
    };
  }

  // 4. Expiry date check
  if (coupon.expiry_date && new Date(coupon.expiry_date) < now) {
    return {
      valid: false,
      status: 400,
      reason: 'expired',
      message: 'This coupon has expired.'
    };
  }

  // 5. Global usage limit check
  if (coupon.usage_limit && Number(coupon.usage_count || 0) >= Number(coupon.usage_limit)) {
    return {
      valid: false,
      status: 400,
      reason: 'usage_limit',
      message: 'Coupon usage limit has been reached.'
    };
  }

  // 6. Per-user usage restriction check
  if (coupon.per_user_limit && userId && models.Order) {
    const userCountOpts = {
      where: {
        user_id: userId,
        coupon_code: cleanCode,
        order_status: { [Op.ne]: 'Cancelled' }
      }
    };
    if (transaction) userCountOpts.transaction = transaction;
    const userUses = await models.Order.count(userCountOpts);
    if (userUses >= Number(coupon.per_user_limit)) {
      return {
        valid: false,
        status: 400,
        reason: 'user_usage_limit',
        message: 'Coupon usage limit has been reached.'
      };
    }
  }

  // 7. Product & Category eligibility check
  let eligibleProductIds = [];
  let eligibleCategoryIds = [];
  try {
    if (coupon.applicable_products) {
      const parsed = typeof coupon.applicable_products === 'string'
        ? JSON.parse(coupon.applicable_products)
        : coupon.applicable_products;
      if (Array.isArray(parsed)) eligibleProductIds = parsed.map((id) => String(id));
    }
  } catch (e) {}
  try {
    if (coupon.applicable_categories) {
      const parsed = typeof coupon.applicable_categories === 'string'
        ? JSON.parse(coupon.applicable_categories)
        : coupon.applicable_categories;
      if (Array.isArray(parsed)) eligibleCategoryIds = parsed.map((id) => String(id).toLowerCase());
    }
  } catch (e) {}

  let orderSubtotal = Math.max(0, parseFloat(subtotal || 0));

  if (Array.isArray(items) && items.length > 0 && (eligibleProductIds.length > 0 || eligibleCategoryIds.length > 0)) {
    // Resolve product details from DB if category info is needed
    let eligibleSubtotal = 0;
    let hasEligibleItem = false;

    for (const item of items) {
      const pid = String(item.product_id || item.id || '');
      let catId = item.category_id ? String(item.category_id).toLowerCase() : '';
      let catName = item.category ? String(typeof item.category === 'object' ? item.category.name : item.category).toLowerCase() : '';

      if (eligibleCategoryIds.length > 0 && !catId && pid && !isNaN(pid) && models.Product) {
        const dbProd = await models.Product.findByPk(parseInt(pid, 10), transaction ? { transaction } : undefined);
        if (dbProd) {
          catId = dbProd.category_id ? String(dbProd.category_id).toLowerCase() : '';
        }
      }

      const matchesProduct = eligibleProductIds.length > 0 && eligibleProductIds.includes(pid);
      const matchesCategory = eligibleCategoryIds.length > 0 && (
        (catId && eligibleCategoryIds.includes(catId)) ||
        (catName && eligibleCategoryIds.includes(catName))
      );

      if (matchesProduct || matchesCategory) {
        hasEligibleItem = true;
        const unitPrice = parseFloat(item.unit_price ?? item.price ?? item.selling_price ?? 0);
        const qty = parseInt(item.quantity || 1, 10);
        eligibleSubtotal += unitPrice * qty;
      }
    }

    if (!hasEligibleItem) {
      return {
        valid: false,
        status: 400,
        reason: 'product_ineligible',
        message: 'This coupon is not applicable to the selected product.'
      };
    }

    if (eligibleSubtotal > 0) {
      orderSubtotal = eligibleSubtotal;
    }
  }

  // 8. Minimum purchase amount check
  const minOrderValue = parseFloat(coupon.min_order_value || 0);
  if (orderSubtotal < minOrderValue) {
    return {
      valid: false,
      status: 400,
      reason: 'min_amount',
      message: 'Minimum purchase amount not met.'
    };
  }

  // 9. Compute discount
  let discount = 0;
  if (coupon.type === 'percentage') {
    discount = (orderSubtotal * parseFloat(coupon.value)) / 100;
    if (coupon.max_discount && discount > parseFloat(coupon.max_discount)) {
      discount = parseFloat(coupon.max_discount);
    }
  } else {
    discount = parseFloat(coupon.value);
  }

  discount = Math.round(Math.min(discount, orderSubtotal));

  return {
    valid: true,
    status: 200,
    coupon,
    discount,
    message: 'Coupon applied successfully!'
  };
}
