from app.model import MySqlConnectionInfo
from app.model.data_source import DataSourceExtension


def test_resolve_optional_value_unwraps_empty_secret():
    info = MySqlConnectionInfo.model_validate(
        {
            "host": "tidb-local",
            "port": 4000,
            "database": "report_demo",
            "user": "root",
            "password": "",
            "sslMode": "DISABLED",
        }
    )

    assert DataSourceExtension._resolve_optional_value(info.password) == ""


def test_mysql_connection_passes_empty_password_as_plain_string(monkeypatch):
    captured = {}
    sentinel = object()

    def fake_connect(**kwargs):
        captured.update(kwargs)
        return sentinel

    monkeypatch.setattr("app.model.data_source.ibis.mysql.connect", fake_connect)

    info = MySqlConnectionInfo.model_validate(
        {
            "host": "tidb-local",
            "port": 4000,
            "database": "report_demo",
            "user": "root",
            "password": "",
            "sslMode": "DISABLED",
        }
    )

    result = DataSourceExtension.mysql.get_mysql_connection(info)

    assert result is sentinel
    assert captured["password"] == ""
    assert isinstance(captured["password"], str)
    assert captured["host"] == "tidb-local"
    assert captured["port"] == 4000
    assert captured["database"] == "report_demo"
    assert captured["user"] == "root"
    assert captured["charset"] == "utf8mb4"
