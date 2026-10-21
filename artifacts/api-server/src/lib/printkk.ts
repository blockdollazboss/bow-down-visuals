/* PrintKK API integration for POD rug fulfillment.
   Docs: https://api-docs.printkk.com/
   Base: https://api.printkk.com/pkk-openapi
   Auth: Api-Key header (from PrintKK Dashboard → Settings → Api Management)
   
   Flow: upload image → create design (async, poll) → create order → pay from wallet
   Note: No webhooks — poll for status. All timestamps UTC-8. Rate limit 60/min.
*/

const PRINTKK_BASE = "https://api.printkk.com/pkk-openapi";
const PRINTKK_API_KEY = process.env.PRINTKK_API_KEY || "";

interface PrintKKImageUploadResult {
  imageId: string;
}

interface PrintKKDesignTaskResult {
  taskId: string;
}

interface PrintKKDesignResult {
  designCode: string;
  designSpecificationCode: string;
}

function headers(): Record<string, string> {
  return {
    "Api-Key": PRINTKK_API_KEY,
    "Content-Type": "application/json",
  };
}

export function printkkConfigured(): boolean {
  return PRINTKK_API_KEY.length > 0;
}

/* Step 1: Upload artwork (multipart/form-data) */
export async function uploadImage(
  imageBuffer: Buffer,
  fileName: string
): Promise<PrintKKImageUploadResult> {
  const formData = new FormData();
  const uint8Array = new Uint8Array(imageBuffer);
  const blob = new Blob([uint8Array], { type: "image/png" });
  formData.append("file", blob, fileName);

  const res = await fetch(`${PRINTKK_BASE}/api/v1/image`, {
    method: "POST",
    headers: { "Api-Key": PRINTKK_API_KEY },
    body: formData,
  });

  if (!res.ok) {
    throw new Error(`PrintKK image upload failed: ${res.status}`);
  }

  const data = (await res.json()) as any;
  return { imageId: data.imageId || data.data?.imageId };
}

/* Step 2: Create design (async — returns taskId) */
export async function createDesign(
  productCode: string,
  printAreaCode: string,
  imageId: string,
  fillingMode: "cover" | "contain" | "fill" = "cover"
): Promise<PrintKKDesignTaskResult> {
  const res = await fetch(`${PRINTKK_BASE}/api/v1/design`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      productCode,
      printAreas: [
        {
          printAreaCode,
          imageId,
          imageFillingMode: fillingMode,
        },
      ],
    }),
  });

  if (!res.ok) {
    throw new Error(`PrintKK design creation failed: ${res.status}`);
  }

  const data = (await res.json()) as any;
  return { taskId: data.taskId || data.data?.taskId };
}

/* Step 3: Poll design task until completed */
export async function pollDesignTask(
  taskId: string,
  maxAttempts = 30,
  intervalMs = 3000
): Promise<PrintKKDesignResult> {
  for (let i = 0; i < maxAttempts; i++) {
    const res = await fetch(`${PRINTKK_BASE}/api/v1/design/task/${taskId}`, {
      headers: { "Api-Key": PRINTKK_API_KEY },
    });

    if (!res.ok) {
      throw new Error(`PrintKK design task poll failed: ${res.status}`);
    }

    const data = (await res.json()) as any;
    const status = data.designTaskStatus || data.data?.designTaskStatus;

    if (status === "completed") {
      const designCode = data.designCode || data.data?.designCode;
      // Get the design specification code
      const designRes = await fetch(`${PRINTKK_BASE}/api/v1/design/${designCode}`, {
        headers: { "Api-Key": PRINTKK_API_KEY },
      });
      const designData = (await designRes.json()) as any;
      return {
        designCode,
        designSpecificationCode:
          designData.designSpecificationCode || designData.data?.designSpecificationCode,
      };
    }

    if (status === "failed") {
      throw new Error(`PrintKK design task failed for task ${taskId}`);
    }

    // Wait before next poll
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`PrintKK design task ${taskId} timed out after ${maxAttempts} attempts`);
}

/* Step 4: Create order */
export interface PrintKKOrderAddress {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  address1: string;
  address2?: string;
  city: string;
  state: string;
  zip: string;
  country: string;
}

export async function createOrder(
  designSpecificationCode: string,
  quantity: number,
  shippingAddress: PrintKKOrderAddress
): Promise<{ orderId: string }> {
  const res = await fetch(`${PRINTKK_BASE}/api/v1/order`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      designSpecificationCode,
      quantity,
      shippingAddress,
      shippingType: ["standard", "express", "economy"],
    }),
  });

  if (!res.ok) {
    throw new Error(`PrintKK order creation failed: ${res.status}`);
  }

  const data = (await res.json()) as any;
  return { orderId: data.orderId || data.data?.orderId };
}

/* Step 5: Pay for order from wallet */
export async function payOrder(orderId: string): Promise<void> {
  const res = await fetch(`${PRINTKK_BASE}/api/v1/pay/wallet`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ orderId }),
  });

  if (!res.ok) {
    throw new Error(`PrintKK order payment failed: ${res.status}`);
  }
}

/* Get order status (poll — no webhooks) */
export async function getOrderStatus(orderId: string): Promise<{ status: string; trackingNumber?: string }> {
  const res = await fetch(`${PRINTKK_BASE}/api/v1/order/${orderId}`, {
    headers: { "Api-Key": PRINTKK_API_KEY },
  });

  if (!res.ok) {
    throw new Error(`PrintKK order status check failed: ${res.status}`);
  }

  const data = (await res.json()) as any;
  const order = data.data || data;
  return {
    status: order.status,
    trackingNumber: order.trackingNumber,
  };
}

/* Full pipeline: image → design → order → pay */
export async function fulfillRugOrder(
  imageBuffer: Buffer,
  fileName: string,
  productCode: string,
  printAreaCode: string,
  quantity: number,
  shippingAddress: PrintKKOrderAddress
): Promise<{ orderId: string; designCode: string }> {
  // 1. Upload image
  const { imageId } = await uploadImage(imageBuffer, fileName);

  // 2. Create design
  const { taskId } = await createDesign(productCode, printAreaCode, imageId);

  // 3. Wait for design to complete
  const { designCode, designSpecificationCode } = await pollDesignTask(taskId);

  // 4. Create order
  const { orderId } = await createOrder(designSpecificationCode, quantity, shippingAddress);

  // 5. Pay from wallet
  await payOrder(orderId);

  return { orderId, designCode };
}

/* Rug product codes (from PrintKK catalog — verify via /api/v1/product/page) */
export const PRINTKK_RUG_PRODUCTS = {
  rectangle: {
    code: "RUG-RECTANGLE", // TODO: Get actual product code from API
    printAreaCode: "FRONT", // TODO: Get actual print area code
    sizes: ['2x3 ft', '3x5 ft', '4x6 ft'],
  },
  round: {
    code: "RUG-ROUND",
    printAreaCode: "FRONT",
    sizes: ['3 ft', '4 ft', '5 ft'],
  },
} as const;
