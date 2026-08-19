const INR_PER_USD = 100;
const SELLING_MARKUP = 1.2;

function toUsd(value) {
  const amount = Number(value);

  if (!Number.isFinite(amount) || amount < 0) {
    return null;
  }

  return amount;
}

function sellingPriceUsd(providerUsd) {
  const usd = toUsd(providerUsd);

  if (usd === null) {
    return null;
  }

  return Number((usd * SELLING_MARKUP).toFixed(4));
}

function sellingPriceInr(providerUsd) {
  const usd = sellingPriceUsd(providerUsd);

  if (usd === null) {
    return null;
  }

  return Number((usd * INR_PER_USD).toFixed(2));
}

module.exports = {
  INR_PER_USD,
  SELLING_MARKUP,
  sellingPriceUsd,
  sellingPriceInr
};
