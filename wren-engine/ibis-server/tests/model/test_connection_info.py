import pytest
from app.model import LocalFileConnectionInfo, MySqlConnectionInfo
from app.model.metadata.dto import MetadataDTO
from pydantic import ValidationError


def test_metadata_dto_prefers_mysql_connection_info_for_mysql_payload():
    dto = MetadataDTO.model_validate(
        {
            "connectionInfo": {
                "host": "tidb-local",
                "port": 4000,
                "database": "report_demo",
                "user": "wren_ro",
                "password": "secret",
                "sslMode": "DISABLED",
            }
        }
    )

    assert isinstance(dto.connection_info, MySqlConnectionInfo)
    assert dto.connection_info.host.get_secret_value() == "tidb-local"
    assert dto.connection_info.database.get_secret_value() == "report_demo"
    assert dto.connection_info.port == 4000


def test_local_file_connection_info_rejects_mysql_payload_shape():
    with pytest.raises(ValidationError):
        LocalFileConnectionInfo.model_validate(
            {
                "host": "tidb-local",
                "port": 4000,
                "database": "report_demo",
                "user": "wren_ro",
            }
        )


def test_metadata_dto_still_accepts_local_file_payload():
    dto = MetadataDTO.model_validate(
        {
            "connectionInfo": {
                "url": "/data",
                "format": "csv",
            }
        }
    )

    assert isinstance(dto.connection_info, LocalFileConnectionInfo)
    assert dto.connection_info.url.get_secret_value() == "/data"
