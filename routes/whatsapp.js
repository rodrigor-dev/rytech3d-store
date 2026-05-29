const { getSettings } = require('../database');

function formatOrderMessage(order, user, items) {
  const lines = [];
  lines.push('🛒 *NOVO PEDIDO - RYTECH3D*');
  lines.push('━━━━━━━━━━━━━━━━━━');
  lines.push(`📋 *Pedido #${order.id}*`);
  lines.push(`📅 ${new Date(order.created_at).toLocaleString('pt-BR')}`);
  lines.push('');
  lines.push('📦 *Itens*');
  items.forEach((item, i) => {
    let line = `${i + 1}. ${item.product_name} - ${item.quantity}x R$ ${(item.quantity * item.price).toFixed(2)}`;
    if (item.variations) {
      const vars = typeof item.variations === 'string' ? JSON.parse(item.variations) : item.variations;
      const varStr = Object.entries(vars).map(([k,v]) => `${k}: ${v.name || v}`).join(', ');
      if (varStr) line += ` (${varStr})`;
    }
    lines.push(line);
  });
  lines.push('');
  lines.push(`💰 *Total: R$ ${order.total.toFixed(2)}*`);
  return lines.join('\n');
}

async function sendWhatsAppNotification(order, user, items) {
  const settings = await getSettings();
  const phone = settings.whatsapp_number;
  if (!phone) {
    console.log('WhatsApp não configurado. Pulando notificação.');
    return;
  }

  const message = formatOrderMessage({ ...order, site_url: settings.site_url }, user, items);
  const encodedMessage = encodeURIComponent(message);
  const url = `https://wa.me/${phone}?text=${encodedMessage}`;

  console.log('\n📱 WhatsApp do pedido #' + order.id + ' gerado:');
  console.log(url);
  console.log('Abra o link para enviar a notificação ao admin.\n');
}

module.exports = { sendWhatsAppNotification, formatOrderMessage };
