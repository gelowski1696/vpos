type HiddenLocationSource = {
  id: string;
  code?: string | null;
  name?: string | null;
};

const SYSTEM_CUSTOMER_CYLINDER_OUTBOUND_CODE = 'LOC-CUST-OUT';
const SYSTEM_CUSTOMER_CYLINDER_OUTBOUND_NAME = 'SYSTEM CUSTOMER CYLINDER OUTBOUND';

function normalize(value: string | null | undefined): string {
  return String(value ?? '').trim().toUpperCase();
}

export function isSystemCustomerCylinderOutboundLocation(location: HiddenLocationSource): boolean {
  const normalizedCode = normalize(location.code);
  const normalizedName = normalize(location.name);
  return (
    normalizedCode === SYSTEM_CUSTOMER_CYLINDER_OUTBOUND_CODE ||
    normalizedName === SYSTEM_CUSTOMER_CYLINDER_OUTBOUND_NAME
  );
}

export function getHiddenSystemLocationIds(locations: HiddenLocationSource[]): Set<string> {
  return new Set(
    locations
      .filter((location) => isSystemCustomerCylinderOutboundLocation(location))
      .map((location) => location.id)
  );
}
