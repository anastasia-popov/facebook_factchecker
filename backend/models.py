from pydantic import BaseModel, field_validator
from typing import Optional


class FactCheckRequest(BaseModel):
    text: str

    @field_validator('text')
    @classmethod
    def text_not_empty(cls, v):
        v = v.strip()
        if not v:
            raise ValueError('text must not be empty')
        return v[:2000]


class SourceLink(BaseModel):
    publisher: str
    url: str


class ClaimResult(BaseModel):
    text: str
    score: float
    verdict: Optional[str] = None
    review_url: Optional[str] = None
    sources: list[SourceLink]


class FactCheckResponse(BaseModel):
    claims: list[ClaimResult]
    post_text_preview: str


class ClaudeFactCheckResponse(BaseModel):
    analysis: str
    post_text_preview: str
