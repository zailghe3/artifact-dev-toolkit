// Synthetic values only. Build service identifiers so source scanning cannot mistake a fixture for a real key.
export const sensitiveFormats = [
 ['bearer header', 'Authorization: Bearer synthetic-bearer-value'],
 ['basic header', 'Authorization: Basic '+Buffer.from('sample:synthetic').toString('base64')],
 ['JSON header', JSON.stringify({Authorization:'Bearer synthetic-json-value'})],
 ['proxy header', 'Proxy-Authorization: Basic '+Buffer.from('sample:synthetic').toString('base64')],
 ['database URI', 'postgresql://sample:synthetic@database.invalid/app'],
 ['encoded database URI', 'mongodb+srv://sample:synthetic%40value@database.invalid/app'],
 ['ODBC', 'Server=database.invalid;Uid=sample;Pwd={short};Database=app'],
 ['libpq', "host=database.invalid user=sample password='short'"],
 ['JDBC', 'jdbc:postgresql://database.invalid/app?user=sample&password=short'],
 ['AWS access ID', ['AKIA','EXAMPLEKEY123456'].join('')],
 ['AWS temporary ID', ['ASIA','EXAMPLEKEY123456'].join('')],
 ['AWS secret field', 'aws_secret_access_key=synthetic-short'],
 ['Azure storage', 'AccountName=sample;AccountKey=synthetic-short;EndpointSuffix=core.windows.net'],
];
