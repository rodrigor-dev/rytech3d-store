const { getSettings } = require('../database');

function formatOrderMessage(order, user, items) {
  const settings = getSettings();
  const lines = [];
  lines.push('🛒 *NOVO PEDIDO - RYTECH3D*');
  lines.push('━━━━━━━━━━━━━━━━━━');
  lines.push('');
  lines.push(`📋 *Pedido #${order.id}*`);
  lines.push(`📅 ${new Date(order.created_at).toLocaleString('pt-BR')}`);
  lines.push('');
  lines.push('👤 *Dados do Cliente*');
  lines.push(`Nome: ${user.full_name}`);
  lines.push(`Email: ${user.email}`);
  lines.push(`Telefone: ${user.phone}`);
  lines.push(`CPF: ${user.cpf}`);
  lines.push(`Endereço: ${user.street}, ${user.number}${user.complement ? ' - ' + user.complement : ''}`);
  lines.push(`Bairro: ${user.neighborhood}`);
  lines.push(`Cidade: ${user.city}/${user.state}`);
  lines.push(`CEP: ${user.zip_code}`);
  lines.push('');
  lines.push('📦 *Itens do Pedido*');
  items.forEach((item, i) => {
    lines.push(`${i + 1}. ${item.product_name} - ${item.quantity}x R$ ${item.price.toFixed(2)} = R$ ${(item.quantity * item.price).toFixed(2)}`);
  });
  lines.push('');
  lines.push(`💰 *Total: R$ ${order.total.toFixed(2)}*`);
  if (order.notes) {
    lines.push('');
    lines.push(`📝 *Observações:* ${order.notes}`);
  }
  lines.push('');
  lines.push('✅ *Aguardando confirmação!*');
  lines.push(`🔗 ${settings.site_url || 'http://localhost:3000'}/admin/orders/${order.id}`);
  return lines.join('\n');
}

async function sendWhatsAppNotification(order, user, items) {
  const settings = getSettings();
  const phone = settings.whatsapp_number;
  if (!phone) {
    console.log('WhatsApp não configurado. Pulando notificação.');
    return;
  }

  const message = formatOrderMessage(order, user, items);
  const encodedMessage = encodeURIComponent(message);
  const url = `https://wa.me/${phone}?text=${encodedMessage}`;

  console.log('\n📱 WhatsApp do pedido #' + order.id + ' gerado:');
  console.log(url);
  console.log('Abra o link para enviar a notificação ao admin.\n');
}

module.exports = { sendWhatsAppNotification, formatOrderMessage };
