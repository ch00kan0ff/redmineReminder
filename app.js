import {Telegraf, Markup} from 'telegraf' //для отсылки сообщений в телегу
import { CronJob } from 'cron'; //планировщик для периодической рассылки
import pkg from 'config-yml';   //либа, которая позволяет хранить настройки в yaml
const { config } = pkg;
import pg from 'pg'  //для работы с БД
const { Query } = pg
const { Client } = pg

const bot = new Telegraf(config.bot.id)  //создаем бота

//создаем клавиатуру для бота
Markup.keyboard([
			["Обслуживание на неделе"],
			["Пропущенное обслуживание"]
		])
			.resize(), //без этого кнопки отображаются криво

//Обработка нажатия кнопки про предстоящие задачи
bot.hears("Обслуживание на неделе", ctx => {
	sendMessageFromDB(config.query.qUpcoming,config.messageTopic.mUpcoming,1,ctx.message.chat.id)
});

//Обработка нажатия кнопки про пропущенные задачи
bot.hears("Пропущенное обслуживание", ctx => {
	sendMessageFromDB(config.query.qExpired,config.messageTopic.mExpired,1,ctx.message.chat.id)
});

bot.launch() //запускаем бота

// Запускаем задание планировщика для получения предстоящих задач
const jobUpcoming = new CronJob(
	config.cron.cUpcoming,
	function () {
		sendMessageFromDB(config.query.qUpcoming,config.messageTopic.mUpcoming)
	},
	null,
	true,
	config.cron.tZone
);

// Запускаем задание планировщика для получения просроченных задач
const jobExpired = new CronJob(
	config.cron.cExpired,
	function () {
		sendMessageFromDB(config.query.qExpired,config.messageTopic.mExpired)
	},
	null,
	true,
	config.cron.tZone
);

// Enable graceful stop, чтобы это такое не было
process.once('SIGINT', () => bot.stop('SIGINT'))
process.once('SIGTERM', () => bot.stop('SIGTERM'))


//Функция для получения данных из БД, формирования и отправки сообщения.
//На вход получает: 
//   qry - запрос, который надо выполнить
//   mes - сообщение заголовок
//   isDirect - признак того, что вызов функции делается человеком (по кнопке)
//   idChat - идентификатор чата, для вызова по кнопке
function sendMessageFromDB(qry,mes,isDirect,idChat){
var message = ''
let usermessage = [] //структура объекта в массиве: idDialog, userName, categories:[category,tasks:[id,task]]

//Создание подключения к БД
const client = new Client({
  user: config.db.user,
  password: config.db.password,
  host: config.db.host,
  port: config.db.port,
  database: config.db.database,
})

const query = new Query(qry) //объект запроса, в который передается SQL из входных параметров (а туда из конфига)
client.connect() //подключение к БД
const result = client.query(query) //Выполнение запроса

//При получении каждой строки запроса выполняется этот код. Код из полученных данных от БД делает объект с данными для формирования сообщения
query.on('row', (row) => {
  if (usermessage.find(diags => diags.idDialog == row.iddialog)){ //тут проверяем есть ли элемент с таким idDialog, как в строке
	const idd = usermessage.findIndex(diags => diags.idDialog == row.iddialog) //если нашелся, то ищем его индекс
	if (usermessage[idd].categories.find(cats => cats.category == row.category)){ //и проверяем та ли у него категория
		const idc = usermessage[idd].categories.findIndex(cats => cats.category == row.category) // если та, то ищем ещё индекс
		usermessage[idd].categories[idc].tasks.push({ // и запихиваем в неё новую задачу
			task: row.task,
			id: row.id
		})
	}
	else { //если такой категории нет, то добавляем новую категорию вместе с задачей
		usermessage[idd].categories.push({
			category: row.category,
			tasks: [{
				task: row.task,
				id: row.id
			},]
		})
	}
	
  }
  else {//добавляем новую строку, если ничего нет вообще или нет записи с таким ид диалога
	  usermessage.push( {
		  idDialog: row.iddialog,
		  userName: row.name,
		  categories: [{
			category: row.category,
			tasks: [{
				task: row.task,
				id: row.id
			},]
		  },]
	  })
  }
})

//Это отрабатывает, когда весь запрос разобран. Формируется сообщение и отсылается в телегу
query.on('end', () => {
  if (usermessage.length != 0){ //тут проверка, что что-то вообще получено
	  usermessage.forEach((um) => {
		 message =  um.userName + '! ' + mes + '\n' //Добавляется обращение и заголовок сообщения
		 um.categories.forEach((cat) => {
			 message += '\n' + (cat.category?cat.category:'Без категории') + ':\n' // пишется категория задач
			 cat.tasks.forEach((t) => {
				 message += '[#' + t.id + '](https://redmine.ch00k.ru/issues/' + t.id + ') ' + t.task + '\n' //пишутся сами задачи со ссылкой на редмайн
			 });
		 });
		 bot.telegram.sendMessage(um.idDialog, message,{parse_mode:'Markdown'}); //отправка сформированного сообщения в бот. Идентификатор диалога берется тоже из БД. Для каждого пользователя отправляется свое сообщение
	 
  });
  }
  else{
	  if (isDirect && idChat){
		bot.telegram.sendMessage(idChat, 'Задач нет!',{parse_mode:'Markdown'}); //При прямом вызове по кнопке, если ничего не получено, то выводится сообщение что задач нет. При вызове планировщиком ничего не отправляется, чтобы не спамить
	  }
  }
  client.end() //останавляваем конект
})

//При возникновении ошибок в запросе пишем это в лог
query.on('error', (err) => {
  console.error(err.stack)
})
}